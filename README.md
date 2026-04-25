# microbots — Agent Memory Graph

A SurrealDB v2-backed persistent behavioral memory graph for AI agents. Agents query this graph instead of starting from scratch each session — context compounds over time.

## Architecture

```
user_profile → integration → entity → chat → memory → skill → workflow
                                                             ↓
                                                        wiki_page (DB)
```

Everything — graph nodes, edges, *and* the markdown navigation layer — lives in SurrealDB. The 18 navigation pages (`user.md`, `integrations/agents.md`, …) are stored as `wiki_page` rows and updated by the wiki agent (Phase 4) from the live graph. There is no on-disk `memory/` directory.

**Start here:** `make wiki-cat P=user.md` (or `P=tree` to list every page).

## Pipeline

```
Phase 1–2  Composio pull → dedup → LLM triage → chat + integration records
Phase 3    Enrichment: memory extraction → entity resolution → skill detection → workflow composition
Phase 4    Wiki agent: graph → diff-update wiki_page rows in SurrealDB
```

Phases 1–4 run automatically on `make ingest`. For local dev without Composio, use `make ingest-seed` to seed the DB with realistic data and run the wiki agent against it.

## Where is the wiki stored?

Two new SurrealDB tables hold the wiki layer (defined in `schema/02_wiki.surql`, seeded by `schema/04_wiki_seed.surql`):

| Table | Role |
|-------|------|
| `wiki_page` | Current state of one navigation page. 18 rows on a fresh DB; `path` is unique, `content` starts empty and is filled by the wiki agent. |
| `wiki_parent` | Edge `wiki_page → wiki_page`. 17 edges total: every non-root page has one parent (depth-3 → depth-2, depth-2 → `user.md`). |
| `wiki_page_revision` | History. Each write archives the prior content; up to 10 most-recent revisions per page are kept. |

Read the wiki from anywhere:

```bash
make wiki-cat P=user.md                                     # this Makefile
uv run python knowledge_graph/seed/wiki_cat.py tree         # python helper
```

```surql
SELECT path, content FROM wiki_page WHERE path = 'user.md';  -- raw SurrealDB
SELECT path, depth FROM wiki_page ORDER BY depth, path;
```

`MicrobotsDB.get_wiki_page(path)` / `list_wiki_tree()` / `write_wiki_page(...)` are the typed Python entry points (see `knowledge_graph/db/wiki.py`).

## Setup

### Prerequisites

- Docker + Docker Compose
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

### Quick start

```bash
# Copy env template and add credentials
cp .env.example .env

# Start SurrealDB, apply schema (which includes the empty wiki skeleton), seed
# the graph with realistic data, then run the wiki agent to fill every wiki_page.
make db-up
make db-schema
make ingest-seed
```

`make db-up` runs `uv sync` automatically — no manual dependency installation needed.

### Full reset (wipes DB + repopulates wiki)

```bash
make db-reset
```

Stops the container, removes the volume, restarts, reapplies schema (including the 18-page wiki skeleton), reseeds the graph, and runs the wiki agent. To clear just the wiki without touching the graph: `make wiki-reset` (sets every `wiki_page.content` back to `""` and bumps the revision).

### Git and ignored files

The `.gitignore` excludes: `.env`, Python caches/virtualenvs, `.composio_cache/`, `backup_*.surql`, IDE folders, OS junk. **Commit** `pyproject.toml`, `uv.lock`, and `.env.example`. Run `cp .env.example .env` on fresh clones.

## Makefile targets

| Target | Action |
|--------|--------|
| `make install` | Install Python deps via `uv sync` |
| `make db-up` | Install deps, start SurrealDB, wait for health |
| `make db-down` | Stop container |
| `make db-schema` | Apply `schema/*.surql` in order (creates wiki skeleton: 18 empty `wiki_page` rows) |
| `make db-seed` | Seed graph with realistic data (1 user, 6 integrations, 10 entities, 4 skills, 3 workflows) |
| `make db-reset` | Full wipe: down + volume remove + up + schema + seed + wiki |
| `make db-query` | Open interactive SurrealQL shell |
| `make db-export` | Export database to `.surql` backup file |
| `make ingest-seed` | Seed graph then run wiki agent to fill every `wiki_page` row (no Composio) |
| `make wiki-reset` | Soft reset: blank every `wiki_page.content`, keep skeleton + edges, bump revision |
| `make wiki-cat P=<path>` | Print one wiki page's content. `P=tree` lists every page. |
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

All Python source lives under `knowledge_graph/` so other product surfaces can sit alongside it without import collisions.

```
microbots/                            (git root)
├── .env.example                  # template; copy to .env
├── docker-compose.yml            # SurrealDB v2
├── Makefile                      # lifecycle targets (see table above)
├── pyproject.toml                # uv-managed dependencies + pytest config
│
└── knowledge_graph/                  # all Python source for the agent memory product
    ├── config.py                 # pipeline + LLM + wiki config dataclasses
    │
    ├── schema/
    │   ├── 00_setup.surql        # namespace, database, analyzers
    │   ├── 01_nodes.surql        # 8 node tables
    │   ├── 02_relations.surql    # 16 graph-relation tables
    │   ├── 02_wiki.surql         # wiki_page, wiki_parent, wiki_page_revision
    │   ├── 03_indexes.surql      # structural, FTS, HNSW vector indexes
    │   ├── 04_wiki_seed.surql    # 18 empty wiki_page rows + 17 parent edges
    │   └── apply.py              # applies *.surql files in order
    │
    ├── seed/
    │   ├── seed.py               # realistic graph data
    │   ├── wiki_from_seed.py     # seed graph + run wiki agent
    │   ├── wiki_reset.py         # soft reset every wiki_page.content
    │   └── wiki_cat.py           # cat one page or print the tree
    │
    ├── ingest/                   # Phase 1–2: Composio pull → triage → SurrealDB
    ├── enrich/                   # Phase 3: memory / entity / skill / workflow
    │
    ├── wiki/                     # Phase 4: Pydantic AI wiki agent
    │   ├── __main__.py           # `python -m wiki`
    │   ├── orchestrator.py       # depth-3 → depth-2 → user.md walker over wiki_page rows
    │   ├── agent.py              # Pydantic AI agent + WikiUpdate model
    │   ├── tools.py              # 5 tools: read/write/list (DB-backed), query_graph, estimate_tokens
    │   ├── deps.py               # WikiDeps (db + config; no filesystem)
    │   └── prompts/              # system + per-page prompt templates
    │
    ├── db/                       # Typed DB wrapper
    │   ├── client.py             # MicrobotsDB: named queries + wiki page operations
    │   ├── queries.py            # SurrealQL query registry
    │   ├── models.py             # Pydantic result models for graph nodes
    │   └── wiki.py               # WikiPage / WikiTreeNode / WikiRevision + read/write helpers
    │
    └── tests/
        ├── conftest.py           # ephemeral SurrealDB fixture, test_db_config
        ├── unit/                 # incl. test_wiki_db.py (DB layer round-trip)
        ├── e2e/                  # seed → wiki agent → assert wiki_page rows
        ├── golden/               # LLM golden replay tests
        ├── synth/                # synthetic corpus generator
        └── eval/                 # closed-loop eval: judge, proposer, rubrics
```

Note: there is no `memory/` directory anywhere; the markdown layer is `wiki_page` rows in SurrealDB.

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

### Unit tests (`knowledge_graph/tests/unit/`)

`test_wiki_db.py` exercises the wiki DB layer directly (round-trip, idempotent hash dedup, revision archive + trim, schema-driven path whitelist, `reset_wiki()` blank-out). `test_db_wrapper.py` covers named-query routing, `test_schema.py` covers SCHEMAFULL constraints. All 30 unit + golden tests run in a few seconds against ephemeral DBs.

### End-to-end test suite (`knowledge_graph/tests/e2e/`)

All tests run against an ephemeral SurrealDB namespace spun up and torn down per-test by `conftest.py`. No production data is touched. The schema (including `04_wiki_seed.surql`) is reapplied per-test, so the 18-page wiki skeleton is always present.

| Test | LLM? | What it checks |
|------|------|----------------|
| `test_seed_populates_graph` | No | Seeding produces the correct node counts: 1 user, 6 integrations, 10 entities, 6 chats, 6 memories, 4 skills, 3 workflows |
| `test_wiki_skeleton_present_after_schema` | No | `list_wiki_tree()` returns exactly 18 `wiki_page` rows with the expected paths, `content=""` and `revision=0`. Verifies the 17 `wiki_parent` edges. |
| `test_wiki_writes_all_pages_to_db` | **Yes** | Full pipeline: seed → wiki agent → every `wiki_page.content` is non-empty in the DB, every `revision >= 1`, every `updated_by="wiki_agent"`. Skipped if no LLM key. |
| `test_wiki_run_idempotent_at_db_level` | **Yes** | Run the wiki agent twice on the same graph — every page still has non-empty content and its revision counter never rolls back. |
| `test_seed_edge_invariants` | No | Structural graph invariants: `chat_from ≥ chat`, `chat_yields ≥ memory`, `skill_derived_from ≥ skill`, `workflow_contains_skill ≥ 2× workflow` |
| `test_corpus_meta_annotations` | No | `tests/fixtures/corpus_meta.json` annotation keys (skipped if file not present) |

**Latest run:** 5/5 e2e pass (1 skipped — corpus_meta), 30 unit/golden pass. ~92 s with two LLM-driven runs against `google/gemini-2.0-flash-001` via OpenRouter.

The full pipeline produces 18 `wiki_page` rows, e.g.:

```
user.md                                        rev=1 bytes=  ~70   # root index, links to all layer pages
integrations/agents.md                         rev=1 bytes= ~120   # depth-2 layer summary
integrations/slack/agents.md                   rev=1 bytes= ~140   # depth-3 per-integration page (with > Parent: link)
entities/person/agents.md                      rev=1 bytes= ~700   # one row per known person from seed
workflows/agents.md                            rev=1 bytes=~1700   # 3 workflows × trigger/outcome/skill chain
```

The wiki agent walks depth-3 pages in parallel (configurable `max_concurrent`), then depth-2 sequentially, then `user.md` last so each level can reference the level below it.

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
