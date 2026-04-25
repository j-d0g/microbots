# microbots — Agent Memory Graph

A SurrealDB v2-backed persistent behavioral memory graph for AI agents. Agents query this graph instead of starting from scratch each session — context compounds over time.

## Architecture

```
user_profile → integration → entity → chat → memory → skill → workflow
```

All structured knowledge lives in SurrealDB. Markdown files in `memory/` are generated navigation artifacts for LLM consumption.

**Start here:** `[memory/user.md](memory/user.md)`

## Setup

### Prerequisites

- Docker + Docker Compose
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

### Quick start

```bash
# Copy the example env and edit credentials
cp .env.example .env
# optional local overrides
# cp .env .env.local

# Start SurrealDB (installs Python deps automatically via uv)
make db-up

# Apply schema
make db-schema

# Seed realistic data
make db-seed
```

`make db-up` runs `uv sync` before starting the container, so no manual dependency installation is needed.

### Git and ignored files

The repo includes a [`.gitignore`](.gitignore) so common generated and secret paths are not committed: local `.env` files, Python caches and virtualenvs, IDE folders, Composio’s `.composio_cache/`, SurrealDB export files matching `backup_*.surql`, and OS junk (e.g. `.DS_Store`). **Do commit** `pyproject.toml`, `uv.lock` (if present), and `.env.example`. For new clones, run `cp .env.example .env` and add your keys locally.

### Full reset

```bash
make db-reset   # down + wipe volume + up + schema + seed
```

## Makefile targets


| Target           | Action                                                   |
| ---------------- | -------------------------------------------------------- |
| `make install`   | Install Python deps via `uv sync`                        |
| `make db-up`     | Install deps, start SurrealDB container, wait for health |
| `make db-down`   | Stop container                                           |
| `make db-schema` | Apply `schema/*.surql` in order via `uv run python`      |
| `make db-seed`   | Run `seed/seed.py` with realistic data                   |
| `make db-reset`  | Full wipe and reseed                                     |
| `make db-query`  | Open interactive SurrealQL shell                         |
| `make db-export` | Export database to `.surql` backup file                  |
| `make composio-ingest` / `make ingest` | Composio → triage → SurrealDB (needs keys + connected apps) |
| `make composio-auth`   | Print the one-time Composio CLI commands (no network)   |


## Composio ingestion and triage (Phase 2)

Pull from connected tools with [Composio](https://composio.dev), classify with a plain LLM (OpenRouter or Anthropic, no agent framework), and write into `integration` + `chat` in SurrealDB.

### Prerequisite: one-time Composio CLI (required before `make ingest`)

A server **API key alone is not enough**. Ingestion calls `tools.execute` per toolkit, which only works if that toolkit has a **connected account** (OAuth / API) stored at Composio for your `user_id`.

Follow the current [Composio CLI](https://docs.composio.dev/docs/cli) (the `composio add …` command is **not** part of the modern CLI; use `composio link` instead):

1. Install the CLI: [Installation](https://docs.composio.dev/docs/cli#installation) (e.g. `curl -fsSL https://composio.dev/install | bash`).
2. **Log in** to Composio: `composio login`
3. **Link each toolkit** you need (lowercase toolkit slug; opens OAuth in the browser unless you use `--no-wait` to print the URL):

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

From the docs: the usual flow is `composio execute …` first; if the CLI says the toolkit is not connected, run `composio link <toolkit>` and retry. You can also connect from the [Composio dashboard](https://app.composio.dev) (connected accounts).

**`COMPOSIO_USER_ID` in `.env` (default `default`)** must be the same [user id](https://docs.composio.dev/docs/connected-accounts) Composio uses for those connections (v3 terminology: `user_id`, not “entity id”).  
In some workspaces Composio links are stored under a consumer-style user id (`consumer-<id>-<org_id>`). Ingest now preflights connected accounts and can auto-resolve common aliases; setting `COMPOSIO_ORG_ID` helps this resolution.

**Discovering tool slugs** (if you see 404 “Tool not found”): use the CLI or dashboard, e.g. `composio tools list github`, `composio search "list my repositories" --toolkits github`, or the [toolkit docs](https://docs.composio.dev/tools/github). Then align names in `ingest/pullers/` with the catalog.

If a pull fails with **"No connected account"** (HTTP 400 / `ConnectedAccountNotFound`), run `composio link <that-toolkit>` (or connect in the dashboard), then re-run ingest.

### Environment variables

Add to `.env` (see `config.py` for tunables such as `backfill_weeks` and model names):

| Variable | Purpose |
| -------- | ------- |
| `COMPOSIO_API_KEY` | Composio server API key |
| `COMPOSIO_USER_ID` | User id for `tools.execute` (default: `default`) |
| `OPENROUTER_API_KEY` | Triage via OpenRouter (default provider) |
| `ANTHROPIC_API_KEY` | Optional: set `LLM` / config to use Haiku instead |

### Run the pipeline

With SurrealDB up and schema applied:

```bash
make composio-ingest
# (equivalent: make ingest)
# or
uv run python -m ingest
# single integration
uv run python -m ingest -i github
```

### End-to-end smoke (no Composio call)

Uses a mock pull, writes triage output (static JSON unless `INGEST_SMOKE_USE_LLM=true`), and checks that a `chat` row exists:

```bash
uv run python -m ingest --smoke
```

For a real LLM call during smoke, set `INGEST_SMOKE_USE_LLM=true` and an LLM API key.

**Note:** Composio tool slugs differ by toolkit version. If a pull returns nothing, check the [Composio dashboard](https://app.composio.dev) for the exact action names and adjust the puller modules under `ingest/pullers/`.


## Repository layout

```
microbots/
├── .gitignore                  # ignored: .env, caches, venv, IDE, backups, …
├── docker-compose.yml          # SurrealDB v2
├── .env.example                # template; copy to .env
├── .env                        # local credentials (gitignored; see above)
├── config.py                   # pipeline + LLM + backfill + scopes
├── Makefile                    # lifecycle targets
├── pyproject.toml              # uv-managed dependencies
├── requirements.txt            # legacy pip reference
│
├── ingest/                     # Composio pull, triage, SurrealDB writers
│   ├── __main__.py             # `python -m ingest`
│   ├── pullers/                # one module per integration
│   ├── prompts/              # per-integration system prompts
│   └── writers/                # integration + chat records
│
├── schema/
│   ├── 00_setup.surql          # namespace, database, analyzers
│   ├── 01_nodes.surql          # 8 node tables
│   ├── 02_relations.surql      # 16 relation/edge tables
│   ├── 03_indexes.surql        # structural, FTS, and HNSW vector indexes
│   └── apply.py                # applies files in order
│
├── seed/
│   └── seed.py                 # seeds realistic data (6 integrations, 10 entities, 6 chats, 6 memories, 4 skills, 3 workflows)
│
└── memory/                     # generated markdown navigation artifacts
    ├── user.md                 # root index
    ├── integrations/agents.md
    ├── integrations/{slack,github,linear,gmail,notion,perplexity}/agents.md
    ├── entities/agents.md
    ├── chats/agents.md
    ├── memories/agents.md
    ├── skills/agents.md
    └── workflows/agents.md
```

## Graph model summary

### Node tables (8)


| Table          | Purpose                                                            |
| -------------- | ------------------------------------------------------------------ |
| `user_profile` | Root actor, single user                                            |
| `integration`  | One node per tool (Slack, GitHub, Linear, Gmail, Notion, Perplexity) |
| `entity`       | Cross-integration nodes (people, channels, repos, projects, teams) |
| `chat`         | Scraped/touched content from integrations                          |
| `memory`       | Distilled high-signal knowledge                                    |
| `skill`        | Repeatable atomic behaviors                                        |
| `workflow`     | Multi-step processes composed of skills                            |
| `layer_index`  | Maps graph layers to markdown navigation artifacts                 |


### Relation tables (16)

`uses_integration`, `appears_in`, `co_used_with`, `related_to_entity`, `chat_from`, `chat_mentions`, `chat_yields`, `memory_about`, `skill_derived_from`, `skill_uses`, `workflow_contains_skill`, `workflow_uses`, `workflow_involves`, `memory_informs`, `indexed_by`, `drills_into`

## Example queries

### "What does the user use Slack for?"

```surql
SELECT user_purpose, usage_patterns, navigation_tips
FROM integration:slack;
```

### "What does the user use Perplexity for?"

```surql
SELECT name, user_purpose, usage_patterns, navigation_tips
FROM integration:perplexity;
```

### "Who should I message about the AI project?"

```surql
SELECT name, ->appears_in[WHERE out = integration:slack].handle AS slack_handle
FROM entity
WHERE tags CONTAINS "ai" OR description ~ "AI";
```

### "Which integrations are co-used for triage?"

```surql
SELECT
    in.name AS from_tool,
    out.name AS to_tool,
    common_context,
    frequency
FROM co_used_with
WHERE common_context ~ "triage";
```

### "What's the deploy workflow?"

```surql
SELECT
    name,
    description,
    trigger,
    outcome,
    ->workflow_contains_skill[ORDER BY step_order]->skill.{name, description, steps} AS skill_steps,
    ->workflow_uses->integration.name AS tools_used
FROM workflow:deploy_pipeline;
```

### "Find me intel on Alice"

```surql
SELECT
    name,
    description,
    entity_type,
    ->appears_in->integration.{name, slug} AS integrations,
    <-chat_mentions<-chat.{title, summary, source_type} AS mentioned_in_chats,
    <-memory_about<-memory.{content, memory_type, confidence} AS related_memories,
    ->related_to_entity->entity.{name, entity_type} AS related_entities
FROM entity:alice;
```

### "What memories inform the deploy workflow?"

```surql
SELECT
    <-memory_informs<-memory.{content, memory_type, confidence} AS informing_memories
FROM workflow:deploy_pipeline;
```

### "Show all high-confidence memories"

```surql
SELECT content, memory_type, confidence
FROM memory
WHERE confidence >= 0.90
ORDER BY confidence DESC;
```

### "Full-text search chats for 'deploy'"

```surql
SELECT title, summary, source_type
FROM chat
WHERE content @@ 'deploy';
```

## Non-goals (this phase)

- `agents.md` auto-generation pipeline
- Real embedding generation (placeholders used)
- Multi-user support
- Real-time sync

## Tech stack


| Component  | Version                                        |
| ---------- | ---------------------------------------------- |
| Database   | SurrealDB v2                                   |
| Container  | Docker + Docker Compose                        |
| Language   | Python 3.11+                                   |
| Python SDK | `surrealdb` (PyPI)                             |
| Embeddings | 1536-dim placeholder (OpenAI-compatible shape) |
| Connectors | Composio (`ingest/`) for Slack, GitHub, Linear, Gmail, Notion, Perplexity |


