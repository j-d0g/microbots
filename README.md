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
# Copy env and edit credentials if needed
cp .env .env.local

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
├── .env                        # credentials and config
├── Makefile                    # lifecycle targets
├── pyproject.toml              # uv-managed dependencies
├── requirements.txt            # legacy pip reference
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


