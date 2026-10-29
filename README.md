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
- With `OPENAI_API_KEY`, click the voice dot for a full-duplex GPT-Live
  conversation (Esc or click again to end); GPT-Live delegates requests to the
  microbots agent, which runs the same tools as typed input.
- `.` hold-to-talk remains OpenAI STT/TTS; without a key, browser speech is the fallback.
- OpenRouter, Composio, and voice-provider keys are optional; configure them in `.env` for their live integrations.

## Development

- Python API: `app/`; KG schema, seed data, and domain code: `knowledge_graph/`.
- Web client: `web/`; its README documents local scripts.
- `make db-schema`, `make db-seed`, `uv run pytest -q`
- API docs: `docs/api-reference.md`; frontend contract: `docs/kg-frontend-contract.md`.

## Knowledge-graph pipeline

`make db-up ingest-demo` ingests local train fixtures through triage, enrichment,
and wiki generation without API keys. Outputs are explicitly labeled offline/demo;
they exercise the pipeline, not real semantic extraction. `make db-reset` restores
the seeded demo afterward. See [KG commands and architecture](knowledge_graph/README.md).
