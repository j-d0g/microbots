# microbots — /web

Next.js 15 App Router frontend for microbots. Voice-native, agent-powered workflow engine UI in a MUJI / Teenage Engineering aesthetic.

See `../.windsurf/plans/microbots_ui_scope_v1-6ba72a.md` for the full UI scoping plan this app implements.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Opens at http://localhost:3000. First load lands on the onboarding screen (a centered breathing dot); after onboarding, the app renders the single-route shell — windowed-mode by default (floating dock + draggable rooms + spotlight command bar). The `MessageSquare` icon in the dock toggles into chat mode (persistent chat history + single embedded room).

### Mock vs real agent

`.env.example` defaults to `NEXT_PUBLIC_MOCK_AGENT=true`, which drives the UI from a timer-based scripted event stream — useful for iterating on motion, layout, and rooms without any LLM calls or backend.

To run against the real agent (OpenRouter → `google/gemini-2.5-flash-lite`):

1. Get a key:
   - Sign in at https://openrouter.ai
   - Open https://openrouter.ai/keys and create a key (any name, default scope is fine).
   - Verify it works before pasting it in: `curl -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/models | head` — you should see JSON, not a `401`.
   - A few dollars of OpenRouter credit goes a long way at Flash-Lite rates.
2. Set `OPENROUTER_API_KEY=...` in `web/.env.local`. (`.env.local` is gitignored — treat it as your secrets file.)
3. Set `NEXT_PUBLIC_MOCK_AGENT=false` in the same file.
4. Stop the running dev server (`Ctrl-C` in the terminal that started it; or `kill <pid>` if you backgrounded it) and run `npm run dev` again — `.env.local` is only read on boot.

The orchestrator chat itself runs entirely on OpenRouter and needs no other keys. The graph room and the integration rooms additionally read from a FastAPI backend (`app/main.py` in the repo root); without it they degrade to empty / "backend offline" states without crashing the rest of the UI.

### Port conflicts and dev-server locks

If port 3000 is taken (common when running this alongside the harness frontend at `agent/harness/frontend/`, which also defaults to 3000), pass `--port` with any free port:

```bash
npx next dev --port 3002   # any free port works; 3001 is also commonly taken
```

Note: use `npx next dev --port …` rather than `npm run dev -- --port …`. The `dev` script in `package.json` hardcodes `--port 3000`, so the npm-script form silently ignores your override.

**Parallel dev from the same `web/` dir**: Next.js 16 keeps a singleton lockfile at `.next/dev/lock`. If another `next dev` already owns this directory — a teammate's instance, a different worktree's instance, or a backgrounded one you've forgotten about — `next dev` will fail with `Another next dev server is already running` *no matter what `--port` you pass*. The error message includes the holding PID. Either:

- Give your second instance its own dist dir + lock (use this if you don't own the holding process):

  ```bash
  NEXT_DIST_DIR=.next-alt npx next dev --port 3002
  ```

  `next.config.ts` already reads `NEXT_DIST_DIR` (defaults to `.next`), so any value gives you a fresh `<value>/lock`. **Heads-up:** Next will auto-rewrite `tsconfig.json` (appends `.next-alt/types/**`) and `next-env.d.ts` (replaces the `./.next/dev/types/routes.d.ts` import) when you do this. Both are auto-managed — revert the diffs before committing, or just leave them; the next default-`.next` run will rewrite them back.

- Or, if you own the holding process, `kill <pid>` it.

### Smoke test

Confirm the dev server is up and configured the way you think it is:

```bash
PORT=3000   # change to whatever your dev server bound

# Page renders:
curl -s -o /dev/null -w "GET / -> %{http_code}\n" http://localhost:$PORT

# Agent route reachable + correctly wired (real vs mock):
curl -sN -D - -X POST http://localhost:$PORT/api/agent/orchestrate \
  -H 'content-type: application/json' \
  -d '{"query":"hi","snapshot":{"viewport":{"w":1440,"h":900},"windows":[],"focusedId":null,"recentActions":[],"user":{"query":"hi"},"ui":{"mode":"windowed"}}}' \
  | head -20
```

Read the response headers:

- `x-agent-model: google/gemini-2.5-flash-lite` — real OpenRouter agent is wired in.
- `x-agent-fallback: local` (with status `503`) — `OPENROUTER_API_KEY` isn't being loaded. Re-check `web/.env.local` and that you fully restarted the dev server. Mock-agent runs (`NEXT_PUBLIC_MOCK_AGENT=true`) intentionally short-circuit on the client and won't hit this route at all.

## Structure

```
app/
  page.tsx                 single route — windowed/chat shell, picks layout from store.uiMode
  layout.tsx               root metadata + viewport
  globals.css              MUJI tokens (paper/ink/indigo)
  api/
    agent/orchestrate/     SSE bridge — POST {query, snapshot} → ui.* / agent.* / reply.* events
    deepgram/token/        ephemeral STT token (stubbed)
    stt/                   ElevenLabs Scribe proxy
    tts/                   Cartesia → ElevenLabs fallback
    voice/config/          which providers are active for STT/TTS
  oauth/return/            Composio OAuth callback handler
  (shell)/                 LEGACY route group, dead code (collapsed into / via single-route refactor); not used at runtime
components/
  agent/                   AgentBridge (mounts SSE), StoreBridge (hydrates), VoiceBridge, SnapshotInspector (debug)
  chat/                    ChatLayout, ChatPanel, EmbeddedRoom (chat mode)
  cards/                   memory / entity / source / diff / toast cards
  command/                 spotlight command bar
  dock/                    floating dock + voice dot + chat-mode toggle
  graph/                   react-force-graph wrapper + inspector
  modal/                   legacy modal stack (backwards compat)
  primitives/              chip, hairline, button
  recipe/                  plain-English workflow steps
  rooms/                   per-room components (Brief / Graph / Workflow / Stack / Waffle / Playbooks / Settings / Onboarding / Integration)
  stack-blocks/            microservice block + log drawer
  stage/                   Desktop, WindowFrame, window-registry (per-room metadata + summary)
lib/
  agent-client.ts          SSE consumer + AgentEvent dispatcher (ui.room / ui.tool / ui.verb / ui.card / reply.* / agent.* / dock)
  agent-router.ts          local fallback when no OpenRouter key (now a single "agent unavailable" toast)
  agent/                   server-side orchestrator + content sub-agent + snapshot helpers
  api/                     FastAPI backend client (KG reads + Composio actions)
  voice.ts                 Web Speech API hooks
  store.ts                 Zustand: windows, dock, cards, chatMessages, uiMode, backendHealth, …
  mock-agent.ts            timer-driven mock event stream (NEXT_PUBLIC_MOCK_AGENT=true)
  seed/                    Maya Chen / Inkwell ontology used for in-memory rooms
agent-evals/               UI agent eval harness (corpus, instrumentation, sprint reports)
tests/                     Playwright + .mjs smoke scripts (see parallel-runs-* dirs for triage runs)
```

## Agent tool vocabulary

The agent drives the UI via three kinds of events received over SSE:

- **Rooms** — `open_brief`, `open_graph`, `open_workflow`, `open_stack`, `open_waffle`, `open_playbook_hub`, `open_settings`
- **Verbs** — `highlight`, `explain`, `compare`, `draft`, `defer`, `confirm`
- **Cards** — `memory`, `entity`, `source`, `diff`, `toast`

See `lib/agent-client.ts` for the typed event schema.
