# microbots — /web

Next.js 15 App Router frontend for microbots. Voice-native, agent-powered workflow engine UI in a MUJI / Teenage Engineering aesthetic.

See `../.windsurf/plans/microbots_ui_scope_v1-6ba72a.md` for the full UI scoping plan this app implements.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Opens at http://localhost:3000 — redirects to `/brief` (the hero room).

No API keys are required to boot: with `NEXT_PUBLIC_MOCK_AGENT=true` the app drives itself off a timer-based mocked agent stream so you can iterate on rooms and motion without backend infra.

## Structure

```
app/
  (shell)/                 floating dock + content plane
    brief/                 hero: morning card stack
    graph/                 live ontology graph
    workflow/              recipe view + DAG toggle
    stack/                 microservice block stack
    waffle/                voice room
    playbooks/             enterprise hub
    settings/              single-column settings
  api/
    agent/stream/          SSE bridge (mock or proxy)
    deepgram/token/        ephemeral STT token
    tts/                   Cartesia/ElevenLabs proxy
components/
  dock/                    floating dock + voice dot
  cards/                   brief, memory, entity, source, diff, toast
  graph/                   react-force-graph wrapper
  recipe/                  plain-English workflow
  stack-blocks/            microservice blocks
  primitives/              chip, hairline, button
lib/
  agent-client.ts          SSE consumer + tool-call router
  voice.ts                 Deepgram + Cartesia hooks (stubbed)
  store.ts                 Zustand: room, dock, cards, voice
  mock-agent.ts            timer-driven mock event stream
styles/tokens.css          MUJI design tokens (paper/ink/indigo)
```

## Agent tool vocabulary

The agent drives the UI via three kinds of events received over SSE:

- **Rooms** — `open_brief`, `open_graph`, `open_workflow`, `open_stack`, `open_waffle`, `open_playbook_hub`, `open_settings`
- **Verbs** — `highlight`, `explain`, `compare`, `draft`, `defer`, `confirm`
- **Cards** — `memory`, `entity`, `source`, `diff`, `toast`

See `lib/agent-client.ts` for the typed event schema.
