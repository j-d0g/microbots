Talk to one agent about your work: it searches your knowledge graph, shows what needs you today, and suggests what to automate.

## Quickstart

Requires [uv](https://docs.astral.sh/uv/), Node.js 22, Bash 4.3+, curl, and either Docker Compose or SurrealDB v2 on PATH.

```bash
cp .env.example .env && cp web/.env.example web/.env.local && make dev
```

Open [localhost:3000](http://localhost:3000). This installs dependencies, starts SurrealDB on :8000, seeds the demo graph, and runs the API on :8001 and chat on :3000. No keys needed.

Try typing:

- "morning brief"
- "what's connected to Linear?"
- "show me the Bug Triage workflow"
- "should I automate PR reviews?"

## Optional keys

Set `OPENROUTER_API_KEY` in `.env` for the real agent, `OPENAI_API_KEY` in `web/.env.local` for voice/GPT-Live, and `COMPOSIO_API_KEY` in `.env` for integrations. Restart after changing keys.

## Local commands

`make help` lists commands. `make test` runs Python tests, TypeScript checks, and Vitest against the running database. `make db-reset` deletes local graph data and restores the demo. `make db-down` stops the database; stopping `make dev` stops both app servers.

If Docker Hub rate-limits pulls, download the static binary for your OS from [SurrealDB v2.3.10 GitHub releases](https://github.com/surrealdb/surrealdb/releases/tag/v2.3.10).
Extract it, make `surreal` executable, and put it on PATH; `make db-up` uses it with root/root in memory on :8000 (data is lost when stopped).

See [web development](web/README.md), [KG pipeline commands](knowledge_graph/README.md), and the [API reference](docs/api-reference.md).
