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
