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
# Copy the env template and fill in any secrets
cp .env.example .env

# Start SurrealDB (installs Python deps automatically via uv)
make db-up

# Apply schema
make db-schema

# Seed realistic data
make db-seed
```

`make db-up` runs `uv sync` before starting the container, so no manual dependency installation is needed.

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


## Repository layout

```
microbots/
├── docker-compose.yml          # SurrealDB v2
├── .env.example                # env template — copy to .env
├── Makefile                    # lifecycle targets
├── pyproject.toml              # uv-managed dependencies
├── requirements.txt            # legacy pip reference
│
├── microbots/                  # shared Python package
│   ├── __init__.py             # public re-exports
│   └── log.py                  # central Logfire-backed logging facade
│
├── schema/
│   ├── 00_setup.surql          # namespace, database, analyzers
│   ├── 01_nodes.surql          # 8 node tables
│   ├── 02_relations.surql      # 16 relation/edge tables
│   ├── 03_indexes.surql        # structural, FTS, and HNSW vector indexes
│   └── apply.py                # applies files in order
│
├── seed/
│   └── seed.py                 # seeds realistic data (5 integrations, 10 entities, 5 chats, 6 memories, 4 skills, 3 workflows)
│
├── docs/
│   ├── feature.md              # product / Render SDK notes
│   └── logging.md              # observability guide (Logfire usage)
│
└── memory/                     # generated markdown navigation artifacts
    ├── user.md                 # root index
    ├── integrations/agents.md
    ├── integrations/{slack,github,linear,gmail,notion}/agents.md
    ├── entities/agents.md
    ├── chats/agents.md
    ├── memories/agents.md
    ├── skills/agents.md
    └── workflows/agents.md
```

## Observability

All scripts and services in this repo log through a single facade in
`microbots/log.py`, backed by [Pydantic Logfire](https://logfire.pydantic.dev).
Four environment variables configure it; the same records are emitted
to the local console **and** to Logfire (when a token is set) — same
timestamps, same attributes, same per-run `correlation_id`.

```bash
# .env
LOGFIRE_TOKEN=                                      # empty = local only
LOGFIRE_SERVICE_NAME=microbots
LOGFIRE_BASE_URL=https://logfire-eu.pydantic.dev    # EU by default
LOGFIRE_ENVIRONMENT=dev
```

```python
from microbots import get_logger, span, instrument, get_correlation_id

log = get_logger(__name__)
log.info("hello {user}", user="alice")

with span("db.query", table="entity"):
    rows = await db.query("SELECT * FROM entity;")

@instrument("workflow.deploy_pipeline")
async def deploy(branch: str) -> str: ...

print("run:", get_correlation_id())                 # e.g. "8c3f1a902b77"
```

Every record automatically carries a 12-char `correlation_id` so a
single run is one query in the Logfire UI:
`correlation_id = "8c3f1a902b77"`. Override via `CORRELATION_ID` env
var to link work across multiple processes.

See [`docs/logging.md`](docs/logging.md) for the full guide — public
API, every use-case (structured logs, spans, exceptions, async,
correlation id propagation), and querying via the Logfire UI / MCP.

## Graph model summary

### Node tables (8)


| Table          | Purpose                                                            |
| -------------- | ------------------------------------------------------------------ |
| `user_profile` | Root actor, single user                                            |
| `integration`  | One node per tool (Slack, GitHub, Linear, Gmail, Notion)           |
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

- Live ingestion from real APIs (Composio)
- Triage agent logic for signal classification
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
| Future     | Composio for live integration connectors       |


