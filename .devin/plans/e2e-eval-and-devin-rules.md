# E2E DB Eval + Devin Self-Tuning Plan (v2)

A bottom-up, prompts-only self-improvement loop where Devin both proposes prompt diffs and judges outputs (n=3, temp=0, per-criterion with evidence), gated by precision-first hard floors plus an equal-thirds KAIG-style retrieval QA scored separately in graph mode and wiki mode.

## Product framing

The SurrealDB graph + `memory/*.md` wiki are the **agent memory layer + ontology of intent** for downstream agents. Eval is biased toward three concrete agent uses (equal weight):

1. **Action recommendation / next-step prediction** — agent answers "the user just opened a PR, what's the standard next step?". Depends on `skill` + `workflow` quality.
2. **Contact / relationship lookup** — agent answers "who reviews repo X?", "who do I escalate Y to?". Depends on `entity` resolution and `appears_in` / `related_to_entity` edges.
3. **Optimisation surface** — agent identifies recurring patterns the user could delegate. Depends on `action_pattern` memories and skill-strength calibration over noisy chats.

The eval is **precision-first across the board**: better to miss than to fabricate. Recall is checked but only against minimum bars.

## Decisions (locked in)

| Decision | Choice |
|---|---|
| Eval signals | (a) per-phase rubric, (b) deterministic structural checks, (c) KAIG-style retrieval QA in **both** graph mode and wiki mode, **reported separately** |
| Precision/recall stance | Precision-first **strict** floors (see § Hard floors) |
| Devin scope | Prompts-only edits in 8 files; **Devin is both proposer and judge** |
| Judging protocol | Devin scores n=3 at temp=0, **per-criterion 0–5 with 1–2 sentence evidence**, median weighted_total decides |
| QA weighting | Equal thirds across the three targets; no regression on any third |
| Cadence | Single bottom-up pass per session: triage → memory → entity → skill → workflow → wiki |
| Commit policy | Auto-commit + push to `devin/eval-<phase>-<UTC ts>` on validated win; no PRs, no merges |
| Corpus | Single Desmond persona + adversarial/noise items (ambiguous entities, low-signal chats, contradictions, multi-integration workflow chains, alias drift) |

## What already exists (reuse, do not rebuild)

- Synth corpus generator + persona: `knowledge_graph/tests/synth/generate_corpus.py`, `persona.yaml`.
- Train/holdout fixtures: `knowledge_graph/tests/fixtures/{train,holdout}/*.json`, `corpus_meta.json`.
- Composio-bypass ingest runner: `knowledge_graph/tests/eval/run_ingest_fixture.py`.
- Rubrics (one per phase): `knowledge_graph/tests/eval/rubrics/*.yaml`.
- Existing harness: `judge.py`, `propose.py`, `apply_and_run.py` — **judge.py and propose.py are dropped from the runtime loop** (kept on disk as schema reference for Devin's output JSON shape).

## Eval signals (in detail)

### Signal A — Per-phase rubric (Devin-judged, n=3, per-criterion 0–5)

For each (phase, label ∈ {baseline, candidate}):

- Devin reads:
  - The rubric YAML in `tests/eval/rubrics/<phase>.yaml`.
  - The phase output dump (JSON) emitted by the harness from a fresh DB run.
  - The corresponding ground-truth slice from `corpus_meta.json`.
- Devin produces **3 independent passes**, each scored fresh (re-reads phase output each pass). Each pass is a JSON file matching the existing `RubricScore` schema in `tests/eval/judge.py`:

```json
{
  "phase": "memory_extraction",
  "criteria": [
    {"criterion": "insight_density", "score": 4, "weight": 0.25,
     "comment": "Memories M3, M7 capture deploy-before-Friday convention; M2 is a literal restatement of the chat (low insight)."}
  ],
  "weighted_total": 3.85,
  "passing": true,
  "comments_global": "..."
}
```

- Saved as `score_<phase>_<label>_run<n>_<ts>.json`. A summary file `score_<phase>_<label>_median_<ts>.json` records the **median weighted_total**, the **median per-criterion score**, and the IQR of weighted_total.
- Stochasticity guard: if the candidate's median weighted_total is within `0.05` of the baseline's, treat as a **tie** → reject.

### Signal B — Structural checks (deterministic, scripted)

Pure-Python `tests/eval/structural.py` (new). Reads SurrealDB after enrichment + `corpus_meta.json`. Emits a JSON scorecard. **No LLM** in this path.

| Check | Definition | Hard floor |
|---|---|---|
| `entity_recall` | expected canonical entities with at least one alias resolved | ≥ 0.80 (regression check, not a hard floor) |
| `entity_precision` | 1 − (duplicate canonical entities / total entities) | **≥ 0.95** (hard floor) |
| `entity_alias_coverage` | mean(aliases_resolved / aliases_expected) per canonical | ≥ 0.70 |
| `memory_hallucination_rate` | memories whose `source_chat_ids` reference chats not present in the injected corpus | **= 0.0** (hard floor) |
| `negative_suppression` | 1 − (memories produced from `expected_negative_chats` / negative chats injected) | **≥ 0.95** (hard floor) |
| `skill_recall` | expected_skills present with `min_strength` met | ≥ 0.70 |
| `workflow_recall` | expected_workflows present with `min_skill_count` met | ≥ 0.70 |
| `workflow_precision` | 1 − (workflows missing a clear trigger/outcome OR fabricated multi-integration links) | **= 1.0** (hard floor) |
| `multi_integration_workflows` | workflows hitting `expected_multi_integration_workflows[*].min_integrations` | reported, gating via workflow_recall |
| `contradiction_handling` | for `expected_contradictions` topics: avg confidence ≤ `max_avg_confidence` AND ≥ 2 memories | reported |
| `wiki_hallucination_rate` | refs in `memory/*.md` to entity/skill/workflow names absent from the graph | **= 0.0** (hard floor) |

### Signal C — KAIG-style retrieval QA (both modes, equal thirds)

`tests/eval/qa_set.yaml` (new) — exactly **15 questions, 5 per target**, each tagged `target ∈ {next_step, contact_lookup, optimisation_surface}`, each with:

- `id`, `question`, `target`, `expected_answer` (string or set), `scoring_mode ∈ {exact_match, set_recall_at_k, free_form_judge}`, `graph_query_name` (optional named query in `db/queries.py` for Graph mode), `relevant_wiki_paths: [memory/...]` (for Wiki mode).

Two scoring modes per question, **reported and gated separately**:

- **Graph mode** (deterministic): execute `graph_query_name` with provided params. Score by `scoring_mode`. No LLM.
- **Wiki mode** (Devin-judged): the harness assembles a context string from `relevant_wiki_paths` and the question; **Devin** answers, then in the same n=3 protocol scores its own answer 0–5 against `expected_answer` with evidence. Median used.

Aggregate scores:

- `qa_graph_total = mean(per_target_means)` over 3 targets.
- `qa_wiki_total = median over 3 runs of mean(per_target_means)`.
- **No regression on any target** in either mode — i.e. for each target ∈ {next_step, contact_lookup, optimisation_surface} and mode ∈ {graph, wiki}: `candidate_target_score >= baseline_target_score - 0.05`.

## Hard floors (block promotion regardless of rubric delta)

A diff is **rejected** if any of the following hold for the candidate run:

- `entity_precision < 0.95`
- `memory_hallucination_rate > 0.0`
- `negative_suppression < 0.95`
- `workflow_precision < 1.0`
- `wiki_hallucination_rate > 0.0`
- Any per-target QA score (graph OR wiki) regresses by > 0.05 vs baseline.
- Median rubric weighted_total within ±0.05 of baseline (tie-band).

## Promotion rule (all must hold)

1. `rubric_median(candidate, train) >= rubric_median(baseline, train) + 0.05`.
2. `rubric_median(candidate, holdout) >= rubric_median(baseline, holdout) + 0.02`.
3. `qa_graph_total(candidate) >= qa_graph_total(baseline)` AND `qa_wiki_total(candidate) >= qa_wiki_total(baseline)` (no regression in either mode).
4. No per-target regression > 0.05 in either mode (see § C).
5. All hard floors pass on candidate.
6. No structural metric in {`entity_recall`, `entity_alias_coverage`, `skill_recall`, `workflow_recall`} drops by more than 0.05 vs baseline.

If 1–6 hold: harness commits the diff to `devin/eval-<phase>-<UTC ts>` and pushes. Otherwise it restores the `.bak` and appends the rejection reason to `tests/eval/reports/rejections.jsonl`.

## Plan (work items)

Order matters: 1–4 produce the artifacts Devin needs; 5 is the rules file; 6 is the smoke test.

### 1. Adversarial corpus extension

- New `tests/synth/adversarial.yaml` with explicit cases:
  - **Two Alices** (Alice Chen vs Alice Park) — distinct emails, must not merge.
  - **Low-signal Slack noise** (`signal_level: low` — lunch, holidays, GIFs) — must yield zero memories.
  - **Contradiction** week-3 vs week-4 about the deploy day rule.
  - **Multi-integration workflow** spanning Linear → GitHub → Slack → Notion.
  - **Alias drift** for Bob: `bob-kim`, `@bob`, `bob@company.com`, `Bob K.`.
- Extend `generate_corpus.py` to merge adversarial templates into the train/holdout split deterministically. New ground-truth keys in `corpus_meta.json`:
  - `expected_negative_chats: [source_id, ...]`
  - `expected_alias_clusters: [{canonical, type, aliases: [...]}]`
  - `expected_multi_integration_workflows: [{slug, min_integrations: 3}]`
  - `expected_contradictions: [{topic, min_memories: 2, max_avg_confidence: 0.7}]`

### 2. `tests/eval/structural.py` (new)

- Implements the 11 checks in § Signal B.
- Reads SurrealDB via existing `db/client.py` (read-only, whitelisted queries; no schema changes).
- Output schema: `{ phase, structural: { metric: value }, hard_floor_violations: [...] }`.
- Writes `structural_<phase>_<label>_<ts>.json` to `tests/eval/reports/`.

### 3. `tests/eval/qa_set.yaml` + `tests/eval/retrieval_qa.py` (new)

- 15 questions, 5 per target, schema described in § Signal C.
- `retrieval_qa.py`:
  - **Graph mode runner**: deterministic, executes `graph_query_name` per question, scores per `scoring_mode`. Writes `qa_graph_<label>_<ts>.json`.
  - **Wiki mode bundler**: assembles per-question context from `relevant_wiki_paths` and emits a single `qa_wiki_inputs_<label>_<ts>.json` for Devin to read, answer, and self-judge n=3. Devin writes `qa_wiki_<label>_run<n>_<ts>.json` and the harness computes the median into `qa_wiki_<label>_median_<ts>.json`.
- Per-target aggregation + per-target gating logic lives in this module so `apply_and_run.py` consumes one combined QA scorecard.

### 4. `tests/eval/run_phase_eval.py` (new) — single Devin-invokable entrypoint

```
uv run python knowledge_graph/tests/eval/run_phase_eval.py \
    --phase <phase> --label <baseline|candidate> --split <train|holdout>
```

Steps (idempotent, no interactive prompts):

1. `docker compose down -v && up -d` and apply schema.
2. Run `tests/eval/run_ingest_fixture.py` for the chosen split.
3. Dump phase output JSON for the requested phase to `tests/eval/reports/phase_output_<phase>_<label>_<split>_<ts>.json`.
4. Run `structural.py` → write structural scorecard.
5. Run `retrieval_qa.py` graph mode → write graph scorecard.
6. Run `retrieval_qa.py` wiki bundler → write `qa_wiki_inputs_*.json` (Devin will fill in answers + scores out-of-band).
7. Print a manifest of all artifact paths Devin must read.

### 5. `tests/eval/apply_and_run.py` rewrite (slim)

Strip out LLM calls. Devin invokes this **after** it has produced all 3 rubric runs, all 3 wiki-QA runs, and the diff is applied. It now only:

1. Re-runs `run_phase_eval.py --label candidate` for both splits.
2. Loads baseline + candidate scorecards (rubric medians, structural, qa_graph, qa_wiki medians).
3. Evaluates **Hard floors** + **Promotion rule** (§ above).
4. On promote: `git add` prompt file, commit, push branch `devin/eval-<phase>-<UTC ts>`.
5. On reject: restore `.bak`, write `rejections.jsonl` entry with structured reasons.

### 6. `.devin/RULES.md` (new) — see § Devin rules below

### 7. `tests/e2e/test_eval_harness_smoke.py` (new)

- Runs `run_phase_eval.py --phase triage --label baseline --split train` against a 3-item fixture.
- Asserts the manifest exists and points at: `phase_output_triage_baseline_train_*.json`, `structural_triage_baseline_train_*.json`, `qa_graph_baseline_train_*.json`, `qa_wiki_inputs_baseline_train_*.json`.
- No LLM call required (Devin-judging steps mocked with synthetic JSON files).

## Devin rules — content of `.devin/RULES.md`

```
# Devin self-tuning rules for microbots agent-memory pipeline

## Mission
Improve the accuracy of the SurrealDB graph + memory/*.md wiki as the agent
memory layer for: (1) action recommendation / next-step prediction,
(2) contact / relationship lookup, (3) optimisation surface ("what could be
automated?"). Bias is precision-first: better to miss than to fabricate.

Pipeline order is fixed:
  triage → memory_extraction → entity_resolution → skill_detection
       → workflow_composition → wiki

## Files you may modify (ONLY these)
  knowledge_graph/ingest/prompts/core.py
  knowledge_graph/enrich/prompts/memory.py
  knowledge_graph/enrich/prompts/entity.py
  knowledge_graph/enrich/prompts/skill_per_integration.py
  knowledge_graph/enrich/prompts/skill_synthesis.py
  knowledge_graph/enrich/prompts/workflow.py
  knowledge_graph/wiki/prompts/system.py
  knowledge_graph/wiki/prompts/per_file.py

## Files you must NOT modify
- knowledge_graph/schema/**          (graph shape is fixed)
- knowledge_graph/db/**              (named queries are the public API)
- knowledge_graph/config.py          (thresholds owned by humans)
- knowledge_graph/{ingest,enrich,wiki}/*.py except the prompt files above
- knowledge_graph/tests/**           (rubrics, fixtures, eval harness are ground truth)
- .devin/**, Makefile, docker-compose.yml, pyproject.toml

## Per-session loop (one bottom-up sweep, no inner loops)
For phase in [triage, memory_extraction, entity_resolution, skill_detection,
              workflow_composition, wiki]:

  ### A. Baseline measurement
  1. uv run python knowledge_graph/tests/eval/run_phase_eval.py \
       --phase $PHASE --label baseline --split train
  2. uv run python knowledge_graph/tests/eval/run_phase_eval.py \
       --phase $PHASE --label baseline --split holdout
  3. JUDGE (n=3, temp=0, per-criterion 0–5 with evidence, fresh re-read each run):
       For each (split, run ∈ {1,2,3}):
         - Read rubric: knowledge_graph/tests/eval/rubrics/$PHASE.yaml
         - Read phase output: phase_output_${PHASE}_baseline_${SPLIT}_*.json
         - Read ground truth: knowledge_graph/tests/fixtures/corpus_meta.json
         - Score every criterion 0–5 with 1–2 sentences citing exact items.
         - Compute weighted_total = sum(score * weight).
         - Write score_${PHASE}_baseline_${SPLIT}_run${N}_<ts>.json.
       Compute median over the 3 runs → score_${PHASE}_baseline_${SPLIT}_median_<ts>.json
  4. WIKI-MODE QA (also n=3, only for the wiki phase or when phase output
     materially affects wiki content): same protocol, write
     qa_wiki_baseline_run${N}_<ts>.json + median file.

  ### B. Propose
  5. Identify the 2–3 lowest-median rubric criteria from the median file.
  6. Edit ONE prompt file from the allow-list. Diff guard rails:
       - Net line-count change ≤ 30% of original.
       - Do not remove ```json``` schema example blocks.
       - Do not remove the required-output-fields list.
       - Only change docstrings, prompt strings, comments. No code restructure.
       - Make the edit minimal and targeted at the lowest-scoring criteria.

  ### C. Candidate measurement
  7. Repeat steps 1–4 with --label candidate.

  ### D. Decide
  8. uv run python knowledge_graph/tests/eval/apply_and_run.py --phase $PHASE
     The harness loads baseline + candidate scorecards and applies the
     promotion rule. Do NOT bypass or second-guess the harness verdict.
  9. If promoted: harness has already committed + pushed
     devin/eval-${PHASE}-<ts>. Move to next phase.
     If rejected: harness has restored the .bak. Move to next phase.
     Do NOT retry the same phase in the same session.

After the bottom-up sweep, stop. The session is done.

## Promotion rule (the harness enforces; do not re-implement or override)
PROMOTE iff ALL of:
  - rubric_median(candidate, train)   >= rubric_median(baseline, train)   + 0.05
  - rubric_median(candidate, holdout) >= rubric_median(baseline, holdout) + 0.02
  - qa_graph_total(candidate) >= qa_graph_total(baseline)        AND no per-target drop > 0.05
  - qa_wiki_total(candidate)  >= qa_wiki_total(baseline)         AND no per-target drop > 0.05
  - All hard floors pass on candidate (see below).
  - No structural recall metric drops by more than 0.05.

## Hard floors (any violation → reject)
  - entity_precision         >= 0.95
  - memory_hallucination_rate = 0.0
  - negative_suppression     >= 0.95
  - workflow_precision        = 1.0
  - wiki_hallucination_rate   = 0.0
  - rubric_median tie band: |candidate − baseline| ≤ 0.05 → reject as tie

## Judging discipline (when you are the judge)
  - Always score 3 independent passes per (phase, split, label). Re-read the
    phase output JSON from disk each pass. Do not "remember" prior scores.
  - Per criterion: integer 0–5 + 1–2 sentence evidence quoting exact ids /
    fields from the phase output. No score without cited evidence.
  - A score of 5 is rare. A score of 0 means "completely wrong / fabricated".
  - Median (not mean) of the 3 weighted_totals decides.

## Optimisation targets (use these to direct your prompt edits)
  - next_step:           skill + workflow precision/recall, trigger→outcome correctness.
  - contact_lookup:      entity resolution precision, alias coverage, appears_in edges.
  - optimisation_surface: action_pattern memory density + confidence calibration on repeated chats.
A prompt edit should improve at least one target without regressing the others.

## Commits
  - Branch:  devin/eval-<phase>-<UTC ts>
  - Message: "eval: promote <phase> <baseline_median>→<candidate_median>"
  - Body:    score deltas (rubric, structural, qa_graph, qa_wiki per target),
             unified diff, lowest-criterion rationale.
  - Push the branch. Do NOT merge. Do NOT open PRs.

## Failure handling
  - LLM/tool errors: retry once, then skip the phase, log to
    tests/eval/reports/errors.jsonl with phase, step, exception.
  - SurrealDB connection error: fail loudly. Do NOT attempt schema repairs.
  - If a phase rejects: do not retry in the same session.

## Out of scope (auto-rejected on review)
  - Any change outside the prompt-file allow-list.
  - New tables, named queries, integrations, agents, pipeline phases.
  - Edits to confidence thresholds, batch sizes, model choices, rubrics.
  - New evaluation criteria, fixtures, or QA questions.
  - Anything touching Composio integrations.
```

## Acceptance criteria for this plan's implementation

- `make synth-corpus` produces a corpus that includes adversarial cases; `corpus_meta.json` carries the four new ground-truth keys.
- `tests/eval/run_phase_eval.py --phase triage --label baseline --split train` produces all four artifacts: `phase_output_*`, `structural_*`, `qa_graph_*`, `qa_wiki_inputs_*`.
- `tests/eval/qa_set.yaml` has exactly 15 questions, 5 per target, each with `expected_answer`, `scoring_mode`, `graph_query_name` (where applicable), `relevant_wiki_paths`.
- `tests/eval/structural.py` returns the 11 metrics in § Signal B and flags hard-floor violations explicitly.
- `tests/eval/apply_and_run.py` contains zero LLM calls; it reads scorecards, applies the promotion rule deterministically, and commits/restores accordingly.
- `.devin/RULES.md` exists and matches the block above byte-for-byte.
- `tests/e2e/test_eval_harness_smoke.py` passes without any LLM key (uses synthetic Devin-output JSONs as fixtures).
- No edits to `schema/`, `db/`, `config.py`, or any non-prompt pipeline file.

## Open follow-ups (not in scope)

- Embedding-based retrieval QA (HNSW vector recall) — current QA is graph-traversal + wiki-text only.
- Multi-persona generalization split.
- Tuning rubric weights themselves (humans own this).
- Replacing Devin-as-judge with a stronger pinned model once we trust the protocol.
