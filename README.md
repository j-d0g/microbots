# microbots — Agent Memory Graph

A SurrealDB v2-backed persistent behavioral memory graph for AI agents. Agents query this graph instead of starting from scratch each session — context compounds over time.

## Architecture

```
user_profile → integration → entity → chat → memory → skill → workflow
                                                             ↓
                                                        memory/ (agents.md)
```

All structured knowledge lives in SurrealDB. Markdown files in `memory/` are **generated navigation artifacts** for LLM consumption — produced and diff-updated by the wiki agent (Phase 4) from the live graph.

**Start here:** [`memory/user.md`](memory/user.md)

## Pipeline

```
Phase 1–2  Composio pull → dedup → LLM triage → chat + integration records
Phase 3    Enrichment: memory extraction → entity resolution → skill detection → workflow composition
Phase 4    Wiki agent: graph → diff-update memory/ markdown files
```

Phases 1–4 run automatically on `make ingest`. For local dev without Composio, use `make ingest-seed` to seed the DB with realistic data and regenerate the markdown layer directly.

## Setup

### Prerequisites

- Docker + Docker Compose
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

### Quick start

```bash
# Copy env template and add credentials
cp .env.example .env

# Start SurrealDB, apply schema, seed with realistic data, generate memory/ markdowns
make db-up
make db-schema
make ingest-seed
```

`make db-up` runs `uv sync` automatically — no manual dependency installation needed.

### Full reset (wipes DB + regenerates memory/)

```bash
make db-reset
```

This stops the container, removes the volume, restarts, reapplies schema, re-seeds, and regenerates all markdown files.

### Git and ignored files

The `.gitignore` excludes: `.env`, Python caches/virtualenvs, `.composio_cache/`, `backup_*.surql`, IDE folders, OS junk. **Commit** `pyproject.toml`, `uv.lock`, and `.env.example`. Run `cp .env.example .env` on fresh clones.

## Makefile targets

| Target | Action |
|--------|--------|
| `make install` | Install Python deps via `uv sync` |
| `make db-up` | Install deps, start SurrealDB, wait for health |
| `make db-down` | Stop container |
| `make db-schema` | Apply `schema/*.surql` in order |
| `make db-seed` | Seed graph with realistic data (1 user, 6 integrations, 10 entities, 4 skills, 3 workflows) |
| `make db-reset` | Full wipe: down + volume remove + up + schema + seed + memory-reset + wiki |
| `make db-query` | Open interactive SurrealQL shell |
| `make db-export` | Export database to `.surql` backup file |
| `make ingest-seed` | Seed DB then run wiki agent to generate `memory/` markdowns (no Composio) |
| `make memory-reset` | Delete all generated `memory/*.md` files |
| `make ingest` / `make composio-ingest` | Full Composio pipeline: pull → triage → enrich → wiki |
| `make composio-auth` | Print one-time Composio CLI commands |
| `make wiki` | Run wiki agent standalone against the live DB |
| `make test` | Unit + golden tests (no DB required for most) |
| `make e2e` | End-to-end tests (requires SurrealDB running) |
| `make synth-corpus` | Generate synthetic training corpus |
| `make rerecord-goldens` | Record LLM outputs for golden tests |
| `make eval` | Run closed-loop eval (judge + proposer) |
| `make eval-report` | Print eval rubric scores |

## Composio ingestion (Phase 1–2)

Pull from connected tools with [Composio](https://composio.dev), classify with a plain LLM, and write into `integration` + `chat` in SurrealDB.

### Prerequisite: one-time Composio CLI

A server API key alone is not enough. Ingestion calls `tools.execute` per toolkit, which requires a **connected account** stored at Composio for your `user_id`.

```bash
composio login
composio link slack
composio link github
composio link gmail
composio link linear
composio link notion
composio link perplexityai
composio whoami
```

If a pull fails with "No connected account", run `composio link <toolkit>` then retry.

### Environment variables

Add to `.env`:

| Variable | Purpose |
|----------|---------|
| `COMPOSIO_API_KEY` | Composio server API key |
| `COMPOSIO_USER_ID` | User id for `tools.execute` (default: `default`) |
| `OPENROUTER_API_KEY` | Triage + wiki via OpenRouter (preferred) |
| `ANTHROPIC_API_KEY` | Alternative LLM provider |

### Run the full pipeline

```bash
make composio-ingest        # all integrations
uv run python -m ingest -i github   # single integration
uv run python -m ingest --smoke     # smoke test (no Composio call)
```

### Smoke test (no Composio)

```bash
uv run python -m ingest --smoke
# With real LLM:
INGEST_SMOKE_USE_LLM=true uv run python -m ingest --smoke
```

## Repository layout

```
microbots/
├── .env.example                  # template; copy to .env
├── docker-compose.yml            # SurrealDB v2
├── config.py                     # all pipeline + LLM + wiki config dataclasses
├── Makefile                      # lifecycle targets (see table above)
├── pyproject.toml                # uv-managed dependencies
│
├── schema/
│   ├── 00_setup.surql            # namespace, database, analyzers
│   ├── 01_nodes.surql            # 8 node tables
│   ├── 02_relations.surql        # 16 relation tables + SCHEMAFULL constraints
│   ├── 03_indexes.surql          # structural, FTS, and HNSW vector indexes
│   └── apply.py                  # applies files in order
│
├── seed/
│   ├── seed.py                   # realistic data: 1 user, 6 integrations, 10 entities, 4 skills, 3 workflows
│   └── wiki_from_seed.py         # seed DB → run wiki agent → write memory/ markdowns
│
├── ingest/                       # Phase 1–2: Composio pull → triage → SurrealDB
│   ├── __main__.py               # `python -m ingest`
│   ├── pullers/                  # one module per integration
│   ├── prompts/                  # per-integration LLM system prompts
│   └── writers/                  # integration + chat record writers
│
├── enrich/                       # Phase 3: memory extraction → entity resolution → skill/workflow
│   ├── orchestrator.py           # runs all 4 enrichment phases sequentially
│   ├── memory_extractor.py
│   ├── entity_resolver.py
│   ├── skill_detector.py
│   ├── workflow_composer.py
│   ├── prompts/                  # enrichment LLM prompts
│   └── writers/                  # memory, entity, skill, workflow writers
│
├── wiki/                         # Phase 4: Pydantic AI wiki agent
│   ├── __main__.py               # `python -m wiki`
│   ├── orchestrator.py           # depth-3 → depth-2 → depth-1 walker
│   ├── targets.py                # derives target paths from live graph
│   ├── agent.py                  # Pydantic AI agent + WikiUpdate model
│   ├── tools.py                  # 5 tools: read/write md, list tree, query_graph, estimate_tokens
│   ├── budgets.py                # token budgets per path depth
│   ├── deps.py                   # WikiDeps dependency injection
│   └── prompts/                  # system + per-file prompt templates
│
├── db/                           # Typed DB wrapper (used by wiki + tests)
│   ├── client.py                 # MicrobotsDB: 10 whitelisted named queries
│   ├── queries.py                # SurrealQL query registry
│   └── models.py                 # Pydantic result models for all node types
│
├── memory/                       # Generated markdown navigation artifacts (gitignored in prod)
│   ├── user.md                   # depth-1: root index (4000 token budget)
│   ├── integrations/agents.md   # depth-2: all integrations summary
│   ├── integrations/{slug}/agents.md  # depth-3: per-integration detail
│   ├── entities/agents.md        # depth-2: all entity types
│   ├── entities/{type}/agents.md # depth-3: per entity-type detail
│   ├── chats/agents.md
│   ├── memories/agents.md
│   ├── skills/agents.md
│   └── workflows/agents.md
│
└── tests/
    ├── conftest.py               # ephemeral SurrealDB fixture, test_db_config
    ├── unit/                     # pure unit tests (no DB for most)
    ├── e2e/                      # seed → wiki → assert markdown files
    ├── golden/                   # golden replay tests
    ├── synth/                    # synthetic corpus generator
    ├── eval/                     # closed-loop eval: judge, proposer, rubrics
    └── fixtures/                 # train + holdout JSON payloads
```

## Graph model

### Node tables (8)

| Table | Purpose |
|-------|---------|
| `user_profile` | Root actor (single user per instance) |
| `integration` | One node per tool (Slack, GitHub, Linear, Gmail, Notion, Perplexity) |
| `entity` | Cross-integration nodes: people, channels, repos, projects, teams |
| `chat` | Scraped/touched content from integrations |
| `memory` | Distilled high-signal knowledge (confidence-scored) |
| `skill` | Repeatable atomic behaviors (strength-scored) |
| `workflow` | Multi-step processes composed of ordered skills |
| `layer_index` | Maps graph layers to markdown navigation artifacts |

### Relation tables (16)

`uses_integration`, `appears_in`, `co_used_with`, `related_to_entity`, `chat_from`, `chat_mentions`, `chat_yields`, `memory_about`, `skill_derived_from`, `skill_uses`, `workflow_contains_skill`, `workflow_uses`, `workflow_involves`, `memory_informs`, `indexed_by`, `drills_into`

## Example queries

### "What does the user use Slack for?"

```surql
SELECT user_purpose, usage_patterns, navigation_tips FROM integration:slack;
```

### "Find intel on Alice"

```surql
SELECT
    name, description, entity_type,
    ->appears_in->integration.{name, slug} AS integrations,
    <-chat_mentions<-chat.{title, summary} AS mentioned_in_chats,
    <-memory_about<-memory.{content, confidence} AS related_memories
FROM entity:alice;
```

### "What's the deploy workflow?"

```surql
SELECT
    name, trigger, outcome,
    ->workflow_contains_skill[ORDER BY step_order]->skill.{name, steps} AS skill_steps,
    ->workflow_uses->integration.name AS tools_used
FROM workflow:deploy_pipeline;
```

### "Show all high-confidence memories"

```surql
SELECT content, memory_type, confidence FROM memory
WHERE confidence >= 0.90 ORDER BY confidence DESC;
```

### "Full-text search chats for 'deploy'"

```surql
SELECT title, summary, source_type FROM chat WHERE content @@ 'deploy';
```

### "Which integrations are co-used for triage?"

```surql
SELECT in.name AS from_tool, out.name AS to_tool, common_context, frequency
FROM co_used_with WHERE common_context ~ "triage";
```

## Testing

```bash
# Unit tests (no DB needed for most)
make test

# End-to-end tests (requires SurrealDB running)
make e2e

# Live wiki write test (requires LLM key + SurrealDB)
LLM_MODE=live make e2e

# Eval loop (requires LLM key)
make eval
make eval-report
```

E2E tests use `seed/seed.py` directly — no Composio, no LLM triage. The `live_llm` marker gates tests that make real LLM calls; they are skipped automatically when no API key is set.

### End-to-end test suite (`tests/e2e/`)

All 6 tests run against an ephemeral SurrealDB namespace spun up and torn down per-test by `conftest.py`. No production data is touched.

| Test | LLM? | What it checks |
|------|------|----------------|
| `test_seed_populates_graph` | No | Seeding produces the correct node counts: 1 user, 6 integrations, 10 entities, 6 chats, 6 memories, 4 skills, 3 workflows, 13 layer_index nodes |
| `test_seed_derives_all_wiki_targets` | No | `derive_targets()` returns 18 ordered paths: 6 integration sub-layers + 5 entity-type sub-layers + 6 layer summaries + `user.md` last (depth 3 → 2 → 1) |
| `test_wiki_writes_all_markdown_files` | **Yes** | Full pipeline: seed → wiki agent → asserts all 18 `memory/` files exist and are non-empty. Skipped automatically if no `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` is set |
| `test_wiki_target_idempotency` | No | `derive_targets()` called twice on the same DB state returns the identical ordered list |
| `test_seed_edge_invariants` | No | Structural graph invariants: `chat_from ≥ chat`, `chat_yields ≥ memory`, `skill_derived_from ≥ skill`, `workflow_contains_skill ≥ 2× workflow` |
| `test_corpus_meta_annotations` | No | `tests/fixtures/corpus_meta.json` contains `expected_entities`, `expected_skills`, `expected_workflows` keys (skipped if file not present) |

**Latest run:** 6/6 passed (~60 s, `google/gemini-2.0-flash-001` via OpenRouter).

The LLM test (`test_wiki_writes_all_markdown_files`) produces 18 files:

```
chats/agents.md                       # chat summary across all integrations
entities/agents.md                    # all entity types overview
entities/{channel,person,project,repo,team}/agents.md  # 5 per-type pages
integrations/agents.md                # all integrations overview
integrations/{github,gmail,linear,notion,perplexity,slack}/agents.md  # 6 per-tool pages
memories/agents.md                    # distilled memories summary
skills/agents.md                      # 4 skills with steps
user.md                               # root index
workflows/agents.md                   # 3 workflows with trigger/outcome/skill chain
```

The wiki agent runs depth-3 targets in parallel (configurable `max_concurrent`), then depth-2 sequentially, then `user.md` last so each level can reference the level below it.

## Tech stack

| Component | Details |
|-----------|---------|
| Database | SurrealDB v2 (SCHEMAFULL, HNSW vector indexes, FTS) |
| Container | Docker + Docker Compose |
| Language | Python 3.11+ |
| Python SDK | `surrealdb` (PyPI) |
| Agent framework | Pydantic AI (wiki agent) |
| Connectors | Composio (`ingest/`) for all 6 integrations |
| Embeddings | 1536-dim placeholder (OpenAI-compatible shape; real embeddings future work) |
