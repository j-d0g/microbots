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

With `OPENAI_API_KEY`, click the voice dot for a full-duplex GPT-Live
conversation (Esc or click again to end); GPT-Live delegates requests to the
microbots agent, which runs the same tools as typed input. `.` hold-to-talk
remains OpenAI STT/TTS; without a key, browser speech is the fallback. Without
`OPENROUTER_API_KEY`, commands use the deterministic local room router. Composio
connection controls show an unconfigured state unless `COMPOSIO_API_KEY` is set.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Core client code lives in `lib/`; API routes are in `app/api/`; room UI is in `components/rooms/`.
