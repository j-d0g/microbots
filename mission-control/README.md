# Mission Control

Mission Control is a small, voice-and-text workbench for Jordan and a team of specialist agents. A single shepherd handles requests, delegates focused tasks to named arms, and streams changes to the dashboard. It runs in scripted demo mode without API keys and can use OpenAI or Anthropic models when configured.

## Run it

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3100](http://localhost:3100). The first request seeds a sample workday and stores it in `.data/mission-control.db`. Demo mode is the default without an OpenAI key; set `OPENAI_API_KEY` to use the default `openai:gpt-5-mini`, or set `MC_MODEL` to `anthropic:claude-sonnet-5` with `ANTHROPIC_API_KEY`.

`MC_DATA_DIR` selects the SQLite directory, `MC_MAX_ARMS` limits concurrent arm runs, and `MC_DEMO_DELAY_MS` adjusts scripted response latency. The pnpm build policy in `pnpm-workspace.yaml` explicitly allows `better-sqlite3` to build its native module.

## Architecture

- `lib/types.ts` and `lib/widgets.ts` are the shared server/client contracts.
- `lib/server/db.ts`, `store.ts`, and `bus.ts` provide SQLite persistence and live events; `seed.ts` and `boot.ts` initialize the demo workspace.
- `lib/server/model.ts`, `demo-model.ts`, `pricing.ts`, and `telemetry.ts` select models, script no-key workflows, and record token/cost traces.
- `lib/server/shepherd.ts` serializes user turns and exposes orchestration tools. `lib/server/arms.ts` queues specialist runs and manages artifacts, asks, and task completion.
- `app/api/**` exposes state, commands, task and agent operations, voice endpoints, reset, and the SSE event stream.
- `lib/client/reducer.ts`, `store.ts`, `use-live-state.ts`, and `api.ts` keep the browser state synchronized and provide typed request helpers.

## Extending it

- **Add a tool:** add a Zod `inputSchema` and `execute` handler in `shepherdTools` or `buildTools` in `lib/server/shepherd.ts` or `lib/server/arms.ts`. Wrap external work with `traced()` so success, failures, and timing appear in the feed.
- **Add an agent:** create an `Agent` using the shared type, persist it with `upsertAgent()`, and give it a focused `goal`; spawned agents can be created through the shepherd's `spawn_agent` tool or `POST /api/agents`.
- **Add a widget:** extend the discriminated union in `lib/widgets.ts`, then render the new kind in the UI. `showWidgets()` validates stage payloads against this schema and keeps the latest six.

## Model notes

The default model ID is `openai:gpt-5-mini`; the app keeps that requested ID and records token costs at **$0.25/M input** and **$2/M output**. OpenAI currently marks GPT-5 Mini as deprecated: <https://platform.openai.com/docs/models/gpt-5-mini>. The optional Claude Sonnet 5 entry is priced at **$2/M input** and **$10/M output** per Anthropic's model overview: <https://docs.anthropic.com/en/about-claude/models>.
