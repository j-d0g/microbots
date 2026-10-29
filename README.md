# Microbots

Microbots is a local-first knowledge graph for agent memory, backed by SurrealDB.

## Quickstart

Prerequisites: Docker with Compose, [uv](https://docs.astral.sh/uv/), and Node.js 22.

```bash
cp .env.example .env
cp web/.env.example web/.env.local
make dev
```

`make dev` starts SurrealDB, applies the schema, seeds demo data, then runs the API on port 8001 and the web app on port 3000. Open [http://localhost:3000](http://localhost:3000).

### Works without API keys

- The shepherd uses a deterministic local router to open relevant rooms.
- The knowledge graph is populated from local seed data in SurrealDB.
- Voice input uses the browser speech fallback.
- OpenRouter, Composio, and voice-provider keys are optional; configure them in `.env` for their live integrations.

## Development

- Python API: `app/`; KG schema, seed data, and domain code: `knowledge_graph/`.
- Web client: `web/`; its README documents local scripts.
- `make db-schema`, `make db-seed`, `uv run pytest -q`
- API docs: `docs/api-reference.md`; frontend contract: `docs/kg-frontend-contract.md`.
