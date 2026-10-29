# Microbots web

Chat-first Next.js client for Microbots. Ask one agent about your knowledge graph, daily priorities, and possible automations; results and tool traces appear inline.

## Run

From the repository root, copy both env templates and run `make dev`. It installs dependencies and starts the database, Python API (:8001), and web client (:3000).

For web-only development, use Node.js 22 and copy `.env.example` to `.env.local` in this directory. Keep the backend running separately:

```bash
npm ci
npm run dev
```

## Local behavior

The default `MICROBOTS_AGENT_MODEL=scripted` uses the agent endpoint, tools, and streaming responses without provider keys. Try "morning brief", "what's connected to Linear?", "show me the Bug Triage workflow", or "should I automate PR reviews?". Delete that setting to use the keyword router instead.

For `make dev`, set `OPENROUTER_API_KEY` in the root `.env` to use the real agent; it takes precedence over the scripted model. For web-only runs, set it in `.env.local` instead. The default backend URL is `http://localhost:8001`. Integrations require `COMPOSIO_API_KEY` in the root `.env`; without it, connection controls show an unconfigured state.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

`make test` at the repository root also runs the Python tests. Core client code lives in `lib/`; API routes are in `app/api/`; chat UI is in `components/chat/`.
