# Architecture Suggestions — Microbots Eval Baseline

**Generated:** 2026-04-25 (static analysis pass — no live DB run)  
**Analyst:** sub-agent E2E eval sweep  
**Scope:** Full codebase read + test-suite static analysis + fixture inspection

---

## 1. Executive Summary

The microbots architecture is **well-structured and production-oriented** for a solo/small-team agent memory system. The five-phase pipeline (pull → triage → enrich → wiki → eval) is cleanly layered, the graph schema is coherent, and the eval harness (rubrics + judge + proposer) is genuinely sophisticated. The issues below are **not blockers** — they are the next layer of technical debt to clear before the self-improvement eval loop (`make eval`) can run reliably end-to-end.

---

## 2. Test Suite — Static Analysis Results

### 2.1 Dependency: SurrealDB must be running

Every test in `tests/unit/` and `tests/e2e/` requires a live SurrealDB connection on `ws://localhost:8000/rpc` (or `SURREAL_TEST_PORT`). There is **no mock/stub mode**. If Docker is not running, the entire suite fails at fixture setup with a connection error, not a helpful skip message.

**Impact:** `pytest tests/ -v` → all async tests fail with `ConnectionRefusedError` if `docker compose up -d` was not run first.

**Suggestion:** Add a session-scoped connectivity check in `conftest.py` that emits `pytest.skip` (not an error) when SurrealDB is unreachable, so unit tests that do have mocks (e.g. `test_wiki_tools.py`) can still run in CI without Docker.

```python
# In conftest.py — proposed addition
@pytest.fixture(scope="session", autouse=True)
def require_surreal():
    import socket, pytest
    host, port = "localhost", int(os.getenv("SURREAL_TEST_PORT", "8000"))
    try:
        socket.create_connection((host, port), timeout=1).close()
    except OSError:
        pytest.skip(f"SurrealDB not reachable at {host}:{port} — start with: docker compose up -d")
```

### 2.2 Wiki module missing from e2e import path

`test_ingest_to_wiki.py` line 173 imports `from wiki.targets import derive_targets`. This succeeds **only if** the `wiki/` package is on `sys.path` (it is, since the project root is the CWD for `uv run pytest`). The import also pulls in `pydantic_ai` and `tiktoken`. If those are absent from the venv (they are listed in `pyproject.toml` so `uv sync` installs them) the test fails at collection time, not at runtime — confusing error messages.

**Current status:** Should work after `uv sync`. No action required if the venv is managed by `uv`.

### 2.3 `test_full_pipeline_from_fixtures` — wiki `derive_targets` coverage gap

The e2e test validates that `derive_targets()` returns the correct set of paths **from the integration slugs seeded**. However, `derive_targets` also calls `entity_types` to add per-type sub-layers (e.g. `entities/person/agents.md`). The test does **not** assert those entity sub-layers — only the integration ones. This means entity resolution failures (no entity nodes in DB) will silently produce an incomplete target list that the test still passes.

**Suggestion:** Add an assertion for at least the static layers (no entity rows needed):
```python
# After seeding entities, also assert entity sub-layers appear
```

### 2.4 `test_chat_provenance_invariant` — invariant is not actually enforced

The test docstring says "Every chat should have either: a `chat_yields` edge, a `chat_mentions` edge, or `signal_level=noise`." But the test body only checks `chat_count >= len(items)` — it does **not** query `chat_yields` or `chat_mentions` at all. The invariant is unenforced.

**Suggestion:** After injecting fixtures, run enrichment (or at least verify `signal_level=noise` chats are excluded) and query the edges:
```python
res = await test_db.query(
    "SELECT id FROM chat WHERE signal_level != 'noise' "
    "AND (SELECT count() FROM chat_yields WHERE in = $parent.id)[0] = 0 "
    "AND (SELECT count() FROM chat_mentions WHERE in = $parent.id)[0] = 0"
)
# Should be empty after enrichment
```

### 2.5 Sync `asyncio.get_event_loop().run_until_complete()` in sync tests

`test_unknown_query_rejected`, `test_raw_surql_cannot_be_injected`, and `test_integration_detail_requires_slug` in `test_db_wrapper.py` use the deprecated `asyncio.get_event_loop().run_until_complete()` pattern inside sync test functions. In Python 3.12+ this raises a `DeprecationWarning` and will eventually fail since there is no running event loop in the test function body when `pytest-asyncio` manages the loop.

**Fix:** Either mark these tests `@pytest.mark.asyncio async def` or use `asyncio.run()`:
```python
def test_unknown_query_rejected(microbots_db):
    import asyncio
    with pytest.raises(ValueError, match="Unknown named query"):
        asyncio.run(microbots_db.named_query("DROP TABLE user_profile"))
```

### 2.6 `asyncio_default_fixture_loop_scope` warning

`pyproject.toml` sets `asyncio_default_fixture_loop_scope = "function"` which is correct for the function-scoped `test_db` fixture. However the `event_loop` fixture in `conftest.py` is session-scoped, creating a mismatch. `pytest-asyncio >= 0.23` emits a deprecation warning about this and may break in future versions.

**Fix:** Either remove the explicit `event_loop` fixture (let pytest-asyncio manage it) or align the scope:
```toml
# pyproject.toml
asyncio_default_fixture_loop_scope = "function"
# and remove the session-scoped event_loop fixture from conftest.py
```

### 2.7 `corpus_meta.json` test skip vs fail

`test_corpus_meta_annotations` calls `pytest.skip` when `expected_entities` is empty — but the fixture file exists and has valid content (`corpus_meta.json` has 5 entities, 2 skills, 1 workflow). The test should always run when fixtures are present. The skip guard will hide regressions if `generate_corpus.py` is re-run and the keys are accidentally emptied.

**Suggestion:** Assert the file exists before checking content:
```python
assert CORPUS_META.exists(), "corpus_meta.json missing — run: make synth-corpus"
meta = load_corpus_meta()
assert meta["expected_entities"]  # fail, not skip, if empty
```

---

## 3. Enrichment Pipeline — Static Count Estimate

Since the live DB was not available for this sweep, counts are estimated from fixture content and pipeline logic:

| Integration | Train items | High-signal | Expected memories |
|------------|------------|-------------|------------------|
| slack      | 6 (5 high, 1 mid) | 5 | 3–5 (deploy convention, HNSW DIMENSION, code review pattern) |
| github     | 15 (10 high, 5 mid) | 10 | 2–4 (type hints, PR convention, reviewer patterns) |
| linear     | 12 (all curated) | 12 | 2–3 (Linear-before-PR pattern, project structure) |
| gmail      | 6 (all mid) | 0 | 0–1 (mid signal, may extract vendor/investor patterns) |
| notion     | 6 (3 high, 3 mid) | 3 | 1–2 (deploy runbook pattern, SurrealDB ADR) |
| perplexity | 9 (all high) | 9 | 2–3 (HNSW tuning, PydanticAI choice, SurrealDB graph queries) |
| **Total**  | **54 chats** | **39 high-signal** | **10–18 memories** |

**Expected skills (cross-integration synthesis):**  
`deploy_flow` (strength ≥ 3 — repeated deploy threads across Slack+GitHub+Linear), `pr_review_flow` (strength ≥ 3 — repeated PR pattern across GitHub+Linear), possibly `linear_ticketing` and `research_before_impl`. Corpus meta expects `deploy_flow` (min_strength 2) and `pr_review_flow` (min_strength 2) — both should be detected.

**Expected workflows:**  
`bug_triage_pipeline` (min_skill_count 2) — should be composed from `deploy_flow` + `pr_review_flow` or equivalent.

**Expected entity resolution:**  
10 pre-seeded entities (Alice Chen, Bob Kim, Carol Diaz, 2 channels, 2 repos, 2 projects, 1 team). The entity resolver should enrich descriptions and add `appears_in` edges but not create new stubs since names are already canonical in seed data. Resolved count: ~10.

**Projected enrichment output from 54 train chats:**

```
memories          : ~14  (range 10–18)
entities_resolved : ~10  (pre-seeded stubs enriched)
skills            : ~3   (deploy_flow, pr_review_flow, + 1 composite)
workflows         : ~1   (bug_triage_pipeline or deploy_pipeline)
```

> **Note:** Actual counts depend on LLM output quality and `OPENROUTER_API_KEY` availability.
> Run `uv run python tests/eval/run_ingest_fixture.py` to get live counts.

---

## 4. Memory Tree Audit

The `memory/` directory contains **hand-authored seed markdown** only. No files were auto-updated by the wiki agent during this sweep because the pipeline was not run live. All existing files are static seeds.

### Current tree

```
memory/
├── user.md                           ✅ Depth-1, 42 lines, well-formed
├── chats/agents.md                   ✅ Depth-2, 39 lines, references seeded chats
├── entities/agents.md                ✅ Depth-2, 56 lines, 10 entities documented
├── integrations/
│   ├── agents.md                     ✅ Depth-2, 47 lines, 6 integrations + co-usage table
│   ├── slack/agents.md               ✅ Depth-3, 43 lines, channels + behavioral patterns
│   ├── github/agents.md              ✅ (exists — not read; assumed seeded)
│   ├── linear/agents.md              ✅ (exists — not read; assumed seeded)
│   ├── gmail/agents.md               ✅ (exists — not read; assumed seeded)
│   ├── notion/agents.md              ✅ (exists — not read; assumed seeded)
│   └── perplexity/agents.md          ✅ (exists — not read; assumed seeded)
├── memories/agents.md                ✅ Depth-2, 42 lines, 6 memories with confidence
├── skills/agents.md                  ✅ Depth-2, 60 lines, 4 skills with full step lists
└── workflows/agents.md               ✅ Depth-2, 58 lines, 3 workflows with skill chains
```

**Key observation:** The wiki agent (`wiki/agent.py`) is **not** invoked from `ingest/__main__.py` automatically — it lives in a separate `wiki/` entry point (`python -m wiki`). So bypassing Composio/triage (as in the test harness) never triggers wiki file writes. The `memory/` tree you see is 100% hand-seeded from `seed/seed.py` content plus manual authoring — the live wiki agent would overwrite these with DB-derived content on first real `make wiki` run.

**Missing depth-3 targets not yet created:**
- `memory/entities/person/agents.md` — would be created by wiki after entity_types query returns "person"
- `memory/entities/repo/agents.md`
- `memory/entities/channel/agents.md`
- etc.

These will appear after `make wiki` is run against a populated DB.

---

## 5. Architecture Suggestions — Prioritised

### P0 — Correctness / Blocking

#### 5.1 `skill_derived_from` relation type mismatch
`schema/02_relations.surql` line 42: `DEFINE TABLE skill_derived_from … TYPE RELATION IN skill OUT chat | workflow`. But `skill_writer.py` writes `RELATE s_rec->skill_derived_from->m_rec` where `m_rec` is a `memory:` RecordID, not a `chat` or `workflow`. SurrealDB SCHEMAFULL validation will **silently drop** or error on these edges. Either:
- Widen the OUT type: `OUT chat | memory | workflow`, or
- Change `skill_writer.py` to use `skill_derived_from` only for chats and add a separate `skill_informed_by` relation for memories.

#### 5.2 `workflow_contains_skill` dedup is missing
`relate_unique` checks `in + out` uniqueness but `workflow_contains_skill` has a `step_order` field. If `compose_workflows` is called twice (re-enrichment), it will find the existing edge (same `in`+`out`) and skip it — but `step_order` may have changed. The guard should include `step_order` in the uniqueness check or use `MERGE` instead of `RELATE`.

#### 5.3 `memory_about` OUT type is too narrow
`schema/02_relations.surql` line 38: `OUT entity | integration`. But `memory_writer.py` tries to write `memory_about` edges to entities looked up by name — if the entity lookup returns a RecordID from a different table (e.g. a future `person` table), SurrealDB will reject it. Ensure all entity lookups return `entity:` RecordIDs only.

---

### P1 — Quality / Reliability

#### 5.4 No embedding writes in enrichment path
`memory_writer.py`, `skill_writer.py`, `workflow_writer.py` all write records with no `embedding` field. The schema defines `embedding ON memory TYPE option<array<float>>`. The HNSW indexes on `memory`, `skill`, `workflow` will never be populated by the enrichment pipeline. Semantic search (`SELECT * FROM memory WHERE embedding <|5|> $q`) will always return empty. Either:
- Add an embedding step after each writer call (call the embedding model, store the vector), or
- Document clearly that embeddings are a Phase 5 TODO.

#### 5.5 LLM provider coupling in `call_llm_json`
`enrich/llm.py` sets `use_json = config.llm.provider == "openrouter"`. If the provider is `"anthropic"`, `use_json_object=False` is passed to `call_llm`, which then skips the `response_format: json_object` header. Anthropic's models can return JSON but without the header they often add preamble text that breaks `json.loads`. The `_strip_fence` function handles markdown fences but not prose preambles ("Sure! Here is the JSON:"). Add a `re.search(r'\{.*\}', raw, re.DOTALL)` fallback extractor.

#### 5.6 Skill strength filter applied after synthesis
`skill_detector.py` line 103 filters skills by `min_strength` **after** Pass 2 synthesis. Pass 1 results already carry strength values. If the LLM in Pass 2 re-estimates strength lower than `min_strength`, all Pass 1 candidates could be dropped even though they individually exceeded the threshold. Consider preserving Pass 1 candidates as a fallback floor.

#### 5.7 `workflow_writer.py` silently drops workflows with < 2 skills
Line 50: `if len(skill_sequence) < 2: return None`. This is correct behaviour but no warning is emitted to the caller and the count returned from `compose_workflows` will be 0 even if the LLM returned valid single-skill workflows. Log a `WARNING` with the workflow slug so it's visible in enrichment logs.

---

### P2 — Observability / Dev Ergonomics

#### 5.8 No enrichment idempotency test
The test suite has `test_wiki_idempotency` but no equivalent for enrichment. Running `run_enrichment` twice on the same chat IDs should produce no duplicate memories (the `_memory_id` content-hash dedup handles this) but no test verifies it. Add:
```python
@pytest.mark.asyncio
@pytest.mark.e2e
async def test_enrichment_idempotency(test_db):
    ids = await inject_fixtures(test_db, "slack", load_fixture("slack")[:2])
    counts1 = await run_enrichment(ids, config)
    counts2 = await run_enrichment(ids, config)
    assert counts2["memories"] == 0  # no new memories on second pass
```

#### 5.9 `apply_and_run.py` candidate scoring is synthetic
Line 187: `candidate_score["weighted_total"] = baseline_total + proposal.expected_score_delta * 0.5` — the candidate is never actually re-scored by the judge against real pipeline output. The promotion gate is gated on the proposer's *self-reported* `expected_score_delta`, not an independent judge evaluation. This undermines the eval loop's signal. Real fix: re-run the pipeline on `tests/fixtures/train/` with the patched prompt, capture the new output, and call `judge.score()` on it before promoting.

#### 5.10 No holdout evaluation in promotion gate
`apply_and_run.py` line 191 checks `candidate_total >= baseline_total + EPSILON` but `HOLDOUT_EPSILON = 0.0` and the holdout fixtures (`tests/fixtures/holdout/`) are never actually scored — the check is vacuously true. Wire up holdout scoring:
```python
holdout_score = await judge_score(phase, holdout_phase_output, holdout_ground_truth)
if holdout_score.weighted_total < baseline_total + HOLDOUT_EPSILON:
    _log_rejection(phase, "Holdout regression")
    continue
```

#### 5.11 `synth/generate_corpus.py` is missing
`Makefile` references `tests/synth/generate_corpus.py` (`make synth-corpus`) but this file does not exist in the repo. The train/holdout fixtures were presumably generated externally and committed. If `make synth-corpus` is ever run it will fail with `ModuleNotFoundError`. Either create the generator script or guard the Makefile target.

#### 5.12 `skill` table missing `strength` field in schema
`schema/01_nodes.surql` does not define a `strength` field on the `skill` table. `skill_writer.py` encodes strength in the `tags` array as `"strength:N"`. The `_Q_SKILLS_ALL` query parses it back with `string::slice`. This is fragile — a tag edit could corrupt the strength value. Add `DEFINE FIELD strength ON skill TYPE int DEFAULT 1;` to the schema and write it directly.

---

### P3 — Future Architecture

#### 5.13 Migrate enrichment phases to Pydantic AI agents
`tests/MIGRATION.md` tracks this. The current vanilla-LLM approach (`call_llm_json` + manual `json.loads`) loses: structured output validation, usage tracking, retries with type safety, and message history. Each enrichment phase is a natural `pydantic_ai.Agent` — the output types already exist as Pydantic models (`TriagePyd`, `ChatRecPyd`, etc.). Priority order: triage → memory_extraction → entity_resolution.

#### 5.14 Add a `replay` mode to the test harness
`LLM_MODE=replay` is referenced in `test_ingest_to_wiki.py` docstring but never implemented — the test always bypasses LLM calls entirely (fixtures are pre-triaged). A real replay mode would store LLM call/response pairs in `tests/golden/` and replay them without API calls, enabling deterministic CI without mocking. This is the standard pattern for LLM test harnesses.

#### 5.15 Consider a `chat_signal_summary` materialized view
The enrichment pipeline queries all chats by signal_level repeatedly. A SurrealDB `LIVE SELECT` or a pre-computed `chat_signal_summary` table (refreshed on upsert) would reduce query cost. Currently each enrichment pass does a full `SELECT * FROM chat WHERE id IN $ids` which scales linearly with corpus size.

---

## 6. Summary Table

| ID | Priority | Category | One-liner |
|----|----------|----------|-----------|
| 5.1 | P0 | Correctness | `skill_derived_from` OUT type excludes `memory` — edges silently dropped |
| 5.2 | P0 | Correctness | `workflow_contains_skill` dedup ignores `step_order` — stale ordering on re-enrichment |
| 5.3 | P0 | Correctness | `memory_about` OUT type should be verified against actual entity table names |
| 5.4 | P1 | Quality | No embeddings written in enrichment path — HNSW indexes are empty |
| 5.5 | P1 | Quality | Anthropic prose preambles break `json.loads` in `call_llm_json` |
| 5.6 | P1 | Quality | Strength filter after synthesis can drop all Pass-1 candidates |
| 5.7 | P1 | Observability | `workflow_writer` silent drop for <2-skill workflows — add WARNING log |
| 5.8 | P2 | Testing | No enrichment idempotency test |
| 5.9 | P2 | Eval loop | `apply_and_run.py` promotions gated on self-reported delta, not re-judged score |
| 5.10 | P2 | Eval loop | Holdout fixtures exist but holdout scoring gate is never actually evaluated |
| 5.11 | P2 | DX | `tests/synth/generate_corpus.py` referenced in Makefile but does not exist |
| 5.12 | P2 | Schema | `skill.strength` not a first-class schema field — stored as tag string |
| 5.13 | P3 | Architecture | Migrate enrichment phases to Pydantic AI agents (tracked in MIGRATION.md) |
| 5.14 | P3 | Testing | Implement real `LLM_MODE=replay` golden-file system for deterministic CI |
| 5.15 | P3 | Performance | Materialised signal-level summary view to reduce full-scan enrichment queries |

---

## 7. Test Suite — Expected Results (static analysis)

Given a running SurrealDB with schema applied:

| Test file | Test name | Expected result | Reason |
|-----------|-----------|-----------------|--------|
| `test_schema.py` | `test_schema_tables_exist` | **PASS** | Schema defines all 7 tables |
| `test_schema.py` | `test_schema_indexes_exist` | **PASS** | INFO FOR TABLE integration succeeds |
| `test_schema.py` | `test_upsert_user_profile` | **PASS** | UPSERT + SELECT is standard SurrealDB |
| `test_schema.py` | `test_upsert_integration` | **PASS** | Slug UPSERT is idempotent |
| `test_schema.py` | `test_relate_chat_from` | **PASS** | RELATE syntax is correct |
| `test_db_wrapper.py` | `test_unknown_query_rejected` | **PASS** | `ValueError` raised immediately in `_get_query_def` |
| `test_db_wrapper.py` | `test_raw_surql_cannot_be_injected` | **PASS** | Same guard |
| `test_db_wrapper.py` | `test_integration_detail_requires_slug` | **PASS** | `_require` raises `ValueError` |
| `test_db_wrapper.py` | `test_integrations_overview_empty` | **PASS** | Returns `[]` on empty DB |
| `test_db_wrapper.py` | `test_integrations_overview_with_data` | **PASS** | Row present after seed |
| `test_db_wrapper.py` | `test_user_profile_query` | **PASS** | Returns dict with nested profile |
| `test_db_wrapper.py` | `test_memories_top_returns_list` | **PASS** | `ORDER BY confidence DESC LIMIT 5` |
| `test_db_wrapper.py` | `test_skills_all_filter` | **PASS** | `strength:4` tag parses via `string::slice` |
| `test_db_wrapper.py` | `test_entity_types_aggregation` | **PASS** | GROUP BY entity_type |
| `test_db_wrapper.py` | `test_entities_by_type` | **PASS** | WHERE entity_type = 'person' |
| `test_db_wrapper.py` | `test_chats_summary_empty` | **PASS** | Empty list on no chat_from edges |
| `test_db_wrapper.py` | `test_workflows_all_empty` | **PASS** | No workflow rows |
| `test_db_wrapper.py` | `test_named_queries_have_descriptions` | **PASS** | All 10 QueryDef have non-empty description |
| `test_db_wrapper.py` | `test_all_registered_query_names` | **PASS** | All 10 expected names present |
| `test_wiki_tools.py` | `test_budget_user_md` | **PASS** | Returns 4000 |
| `test_wiki_tools.py` | `test_budget_layer_agents_md` | **PASS** | Returns 600 |
| `test_wiki_tools.py` | `test_budget_sublayer_agents_md` | **PASS** | Returns 300 |
| `test_wiki_tools.py` | `test_safe_path_ok` | **PASS** | Resolve within memory_root |
| `test_wiki_tools.py` | `test_safe_path_escape_blocked` | **PASS** | `ValueError` on `../../etc/passwd` |
| `test_wiki_tools.py` | `test_read_markdown_missing_file` | **PASS** | Returns `""` |
| `test_wiki_tools.py` | `test_read_markdown_existing_file` | **PASS** | Returns file content |
| `test_wiki_tools.py` | `test_write_markdown_dry_run` | **PASS** | `changed=True`, no file created |
| `test_wiki_tools.py` | `test_write_markdown_creates_file` | **PASS** | File written, `changed=True` |
| `test_wiki_tools.py` | `test_write_markdown_idempotent` | **PASS** | Second write `changed=False` |
| `test_wiki_tools.py` | `test_write_markdown_path_escape_blocked` | **PASS** | `changed=False`, no file |
| `test_wiki_tools.py` | `test_list_markdown_tree` | **PASS** | Both paths in result |
| `test_wiki_tools.py` | `test_estimate_tokens_non_zero` | **PASS** | tiktoken returns >0 |
| `test_wiki_tools.py` | `test_estimate_tokens_empty` | **PASS** | Returns 0 |
| `test_e2e/test_ingest_to_wiki.py` | `test_full_pipeline_from_fixtures` | **PASS** | All 6 train fixtures load; `derive_targets` returns correct path set |
| `test_e2e/test_ingest_to_wiki.py` | `test_wiki_idempotency` | **PASS** | Same target list on two identical calls |
| `test_e2e/test_ingest_to_wiki.py` | `test_chat_provenance_invariant` | **PASS** (vacuous) | Checks count only, not actual edge presence |
| `test_e2e/test_ingest_to_wiki.py` | `test_corpus_meta_annotations` | **PASS** | `corpus_meta.json` has all required keys |

**Caveats (all tests):**
- Require `docker compose up -d` before running.
- The three sync tests in `test_db_wrapper.py` emit `DeprecationWarning` on Python 3.12+ (issue 5.6 above).
- `test_wiki_tools.py` tests are the only ones that run without SurrealDB — they use `MagicMock`. These should be isolated into a `tests/unit/no_db/` sub-suite for fast CI.

**Summary:** 37 tests across 3 files — all expected to **PASS** with Docker running. 0 expected failures. 3 flagged for deprecation warning cleanup.
