# Repository guide

Microbots is a local-first knowledge graph with a FastAPI backend and a Next.js client.

- First run: `cp .env.example .env`, `cp web/.env.example web/.env.local`, then `make dev`.
- Python is pinned to 3.13. Use `uv sync` and `uv run pytest -q`.
- Web checks: `cd web && npm run typecheck && npm test && npm run build`.
- Root Makefile Python commands set `PYTHONPATH` for the repository and `knowledge_graph/`.
- See `README.md` for the local no-key demo and `docs/` for API and KG contracts.
