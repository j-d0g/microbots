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

1. Get a key from https://openrouter.ai (a few dollars of credit goes a long way at Flash-Lite rates).
2. Set `OPENROUTER_API_KEY=...` in `web/.env.local`.
3. Set `NEXT_PUBLIC_MOCK_AGENT=false`.
4. Restart `npm run dev`.

The orchestrator chat itself runs entirely on OpenRouter and needs no other keys. The graph room and the integration rooms additionally read from a FastAPI backend (`app/main.py` in the repo root); without it they degrade to empty / "backend offline" states without crashing the rest of the UI.

### Port conflicts

If port 3000 is taken (common when running this alongside the harness frontend at `agent/harness/frontend/`, which also defaults to 3000), pass `--port`:

```bash
npx next dev --port 3001
```

Nothing in the app config hard-codes 3000 — the dev server's port is the only thing that cares.

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
