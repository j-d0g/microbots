# Microbots web

Next.js client for the local Microbots knowledge graph.

## Run

Use Node.js 22. Copy `.env.example` to `.env.local`; the default backend URL targets `http://localhost:8001`.

```bash
npm install
npm run dev
```

The Python API and seeded SurrealDB are started from the repository root with `make dev`.

## Local behavior

Without `OPENROUTER_API_KEY`, commands use the deterministic local room router. Browser speech is the fallback when voice-provider credentials are absent. Composio connection controls show an unconfigured state unless `COMPOSIO_API_KEY` is set.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Core client code lives in `lib/`; API routes are in `app/api/`; room UI is in `components/rooms/`.
