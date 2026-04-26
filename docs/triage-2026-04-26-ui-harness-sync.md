# Triage — UI / harness / backend sync (2026-04-26)

Cross-cutting status check across the three workstreams, written while the
repo is mid-flight. Consume this before planning today's work.

## TL;DR

**You asked about "two UIs and a regular chat mode".** The state on
`origin/main` is more interesting than that framing:

1. **Desmond's `/web` now ships both UIs in one app** — a *windowed* mode
   (floating draggable rooms + spotlight command bar) and a *chat* mode
   (persistent chat history + single embedded room), toggled via
   `uiMode` in the Zustand store. Both were added as PR merges on
   `origin/main` in the last 24h.
2. **Jordan's `agent/harness/` is a third, separate chat surface** on
   branch `jordan/microbot_harness_v0` — a minimal Next.js chat
   (Anthropic Claude + 4 inline tools) that exists alongside but
   independent of `/web`.
3. **Your local checkout is 55 commits behind `origin/main`.**
   `.worktrees/desmond-ui` mirrors that stale state. Before judging
   what's broken, `git fetch` + checkout the real HEAD.
4. **The friend's most recent UI commit is literally titled
   `feat: UI windowed and chat based, regressing` (SHA `91a7d5b`,
   Made-with: Cursor).** The regression is there on purpose — that's
   the blocker he's talking about. Details in §3.3.
5. The hosted KG MCP (`kg-mcp-2983.onrender.com`) is **returning 404**
   on `/health`, `/mcp`, and `/`. Whatever it used to serve is gone;
   it's been superseded by the unified FastAPI backend at `app/main.py`
   (landed in commit `abdaa05`+, not in your stale local snapshot).

Read §2 for the three-surface map, §3 for the workstream triage, §4 for
the action list.

---

## 1. First, pull the real HEAD

```bash
cd /Users/jordantran/Agemo/microbots
git fetch origin
git log --oneline origin/main ^main   # 55 commits of context you don't have
```

Notable commits you're missing (most recent first):

```
1d152ef fix: agent latency UI
91a7d5b feat: UI windowed and chat based, regressing   ← friend's blocker
0f2655c feat: initial UI
5676d2d Merge feature/ui-iteration-v1 into main
db416b9 Sprint 2: snappy + beautiful
c0592bc feat(web): chat mode -- single-room UI driven by persistent chat history
f0ac59e feat(agent): sprint 1.5 — snappy + truthful + always-stage
a3071e6 Sprint 0 eval harness merged
256f0ec feat: kg write tools (MCP + REST) — 7 endpoints
abdaa05 feat: unified FastAPI backend (MCP + REST + Composio OAuth at one URL)
3ebaa05 feat: agent controlled ui
```

Your `.worktrees/desmond-ui` at `c2f182b` is also stale. If you want to
reproduce or debug the regression, use the real HEAD.

---

## 2. The three surfaces today

Think of the repo as carrying three independently-developed agent
surfaces. They share the KG and (future) the unified backend, but they
do *not* share UI or runtime.

### 2.1 Desmond `/web` — Windowed Mode (shipped, Sprint 2)

Path: `web/` on `origin/main` (and `.worktrees/desmond-ui/web/`
once refreshed).

- Next.js 15 App Router, React 19, Tailwind 4 beta, Zustand.
- Single `/` route, renders `<Desktop>` with draggable/resizable rooms
  (`brief / graph / workflow / stack / waffle / playbooks / settings /
  integration`), `<FloatingDock>`, `<CommandBar>` spotlight,
  `<CardStack>`, `<SnapshotInspector>`.
- Agent: OpenRouter → `google/gemini-2.5-flash-lite` (locked). Three-tier
  delegation (orchestrator → layout-agent + content-agent) via Vercel AI
  SDK `streamText`. SSE bridge at `/api/agent/orchestrate`.
- Sprint 2 metrics (commit `155d734`): TTFW 1704→967ms, marginal-intent
  100%, layout-aesthetic 5.0/5.
- **No persistent chat history**. The command bar streams a single short
  reply, then tucks into a chip above the dock. The reply is ephemeral.

### 2.2 Desmond `/web` — Chat Mode (shipped, commit `c0592bc`)

Same app, different top-level layout. Toggle in the FloatingDock
(MessageSquare icon) or the "WINDOWED" pill in the chat header. Switching
preserves context (focused windowed room becomes chat room and
vice-versa).

- `<ChatLayout>` = split pane. Left: `<ChatPanel>` (persistent chat
  history + input + voice). Right: `<EmbeddedRoom>` (one full-bleed room,
  no window chrome).
- Chat agent semantics: `ui.room` swaps the focused room instead of
  opening a window; `ui.arrange` / `ui.resize` / `ui.close_window` are
  no-ops; `ui.tool` still fires so the agent can navigate within a room;
  `reply.start/chunk/done` are mirrored into `chatMessages` so the chat
  panel renders streaming replies inline with history.
- New store state (`web/lib/store.ts`): `uiMode`, `toggleUiMode`,
  `chatRoom`, `setChatRoom`, `chatMessages`, `appendChatMessage`,
  `appendToLastAgentMessage`, `finalizeLastAgentMessage`,
  `clearChatHistory`.

**This is the "regular chat mode" you were asking about.** It does
exist, it is merged to `origin/main`, and it is architecturally
consistent with the windowed mode (same agent, same tools, same
rooms).

### 2.3 Jordan's `agent/harness/frontend/` — Code-Interpreter chat (v0+v1)

Path: `agent/.worktrees/jordan-microbot_harness_v0/agent/harness/frontend/`
on branch `jordan/microbot_harness_v0` (not merged to `main`).

- Next.js 14.2.18, React 18, no Tailwind (inline styles), `@ai-sdk/react`
  `useChat`. Plain one-page chat UI at `/`.
- Agent: Anthropic SDK → `claude-sonnet-4-6` (default, overridable via
  `ANTHROPIC_MODEL`). `streamText` with 4 **inline** tools (no MCP yet):
  - `run_code(code)` — `spawn("python3", ["-c", code], timeout=30_000)`.
  - `find_examples(query)` — substring match over
    `templates/index.json` (3 seeded templates).
  - `save_workflow(name, code)` — writes `saved/<slug>.py`, returns a
    mock URL `https://example.com/workflows/<slug>`.
  - `ask_user(question, options?)` — **client-resolved** via
    `AskUserPrompt` component in `app/page.tsx`.
- Playwright tests scaffolded at
  `agent/scratchpad/p1-harness-mvp/tests/playwright/` (v0-smoke,
  v1-ask-user, v1-find-examples, v1-multistep, v1-save-workflow). Tests
  **have not been run yet** — `test-results/` is empty.
- Supporting services (not wired into the frontend yet):
  - `agent/harness/mcp/server.py` — FastMCP skeleton, just a `ping` tool,
    bearer-auth middleware. Deployed per `render.yaml` but unused by the
    chat frontend.
  - `agent/harness/workflows/main.py` — Render Workflows app with
    `noop_task`, chain/fanout probes, and a **stub `run_user_code` that
    returns `{"error": "not implemented yet"}`**.

Per `agent/scratchpad/p1-harness-mvp/notes/02-v0-v1-contract.md`, MCP
integration is explicitly deferred to v2; v0+v1 runs entirely inside
Next.js on the user's machine.

### 2.4 Shared backbone (unified backend, landed on `origin/main`)

Path: `app/` on `origin/main` (not in your stale local checkout).

- `app/main.py` — unified FastAPI app.
- `app/mcp/server.py`, `app/mcp/tools.py`, `app/mcp/queries.py` — MCP
  server wrapping the KG. This is the successor to the
  `app/services/kg_mcp/` that your local snapshot shows.
- `app/routes/api_kg.py` — REST endpoints for graph reads/writes (7
  write endpoints added in `256f0ec`).
- `app/routes/api_composio.py` + `app/services/composio.py` — Composio
  OAuth hosted flow. Used by the new `IntegrationRoom`.
- `app/routes/api_health.py` — health probe.
- `app/services/kg_writes.py`, `app/services/surreal.py` — DB helpers.
- `docs/api-reference.md` — frontend-focused API docs (new).

**The web UI consumes this via `web/lib/api/backend.ts`** (392 lines,
introduced in `91a7d5b`). This is the canonical client; anyone else
wiring to the unified backend should route through it.

---

## 3. Workstream triage

### 3.1 Jordan — harness (`agent/` worktree)

**Working**
- v0 chat loop is real code: `agent/harness/frontend/app/page.tsx`
  (212 lines) + `app/api/chat/route.ts` (142 lines) define a full Next.js
  chat with streaming, tool invocation rendering, and a client-side
  `ask_user` prompt.
- All 4 tools are implemented and look correct at read-review:
  `run_code` (subprocess), `find_examples` (substring), `save_workflow`
  (file write), `ask_user` (client-resolved).
- `templates/index.json` seeded with hello-world / fetch-and-count-words
  / slack-ping; `saved/` already has two user-written workflows
  (`daily-greet.py`, `test-ping.py`).
- Render Workflows Phase 0 measured: cold-start p50 ~5.2s, p90 ~6.0s —
  marginal vs 5s hard-stop but decided to green-light with
  warm-keep-alive + token-streaming mitigation
  (`notes/00-render-workflows-cold-start.md`).
- MCP Phase-0 skeleton deployed via `render.yaml` (free plan, generateValue
  MCP_API_TOKEN, `ping` tool + `/health`).
- Latest commit on branch: `7f6ac33 v0+v1: working chat agent with 4
  tools`. Pushed.

**Not working / unverified**
- No Playwright run recorded. `tests/test-results/` is empty. Claims of
  "v0 done" in `02-v0-v1-contract.md` are not backed by a passing
  smoke run. **The very next action on Jordan's branch should be
  `npx playwright test v0-smoke.spec.ts` with the app running, and
  commit the report.**
- `run_user_code` Workflows task is still the "not implemented yet"
  stub. Phase 2 hasn't started.
- MCP server has only `ping`. None of the P1 tools (`consult_docs`,
  `search_templates`, `run_code`, `Ask_User_A_Question`,
  `Set_Behavior_Mode`) are implemented on the server — they only exist
  inline in the frontend's `/api/chat` route. This is intentional per
  the v0/v1 contract (MCP = v2) but it means the harness is currently
  single-machine and not remotely deployable as a demo.
- Postgres chat-history persistence from `plan/02-spec.md` never got
  built. Chat state is in-memory only.
- No awareness in the harness of `origin/main`'s unified backend, KG
  MCP, Composio routes, or `IntegrationRoom` flow. The harness lives in
  a parallel universe.

**Concerns**
- Architectural drift from the rest of the repo: Anthropic (harness) vs
  OpenRouter Gemini Flash-Lite (UI). Different SDK wiring shape
  (inline Vercel AI SDK tools vs MCP-over-HTTP). Different chat
  semantics (persistent history + streamed text vs orchestrator delegating
  to layout/content sub-agents with SSE events like `ui.room` / `ui.card`).
  When integration time comes, one of these has to give.
- `render.yaml` currently only declares the MCP service. The harness
  frontend and workflows service are still manual deploys. If this goes
  to demo, the Blueprint needs to cover them.

**Positives**
- Spec discipline is high. `01-findings.md`, `02-spec.md`, `03-handoff.md`
  are genuinely useful — the contract is tight, the decision log is
  explicit, and `02-v0-v1-contract.md` is an enforceable Done
  definition.
- Phase 0 measurement was done properly (median + p90 + cold-vs-warm
  breakdown, 10-run parallel burst). Good hygiene.
- Clean separation: `scratchpad/` = notes; `harness/` = code. Rules are
  documented in local `AGENTS.md` files at both levels.

### 3.2 Desmond — `/web` UI agent layer

**Working**
- Both UIs ship. Windowed mode has been through Sprints 0, 1, 1.5, 2
  with eval reports committed. Chat mode landed on `c0592bc` and is
  reachable by toggling `uiMode` in the store.
- Three-tier delegation works (orchestrator → layout → content). Eval
  corpus is 80 queries, marginal-intent headline metric is at 100%
  on the latest report (`web/agent-evals/reports/20260426-baseline-ec4af57.json`).
- Sprint 2 latency work paid off: TTFW p50 967ms (down from 1704ms),
  layout-aesthetic 5.0/5, marginal intent held at 100%.
- Per-room tool surface is wide (room-specific tools registered via
  `registerTools()` in each `*Room.tsx`, snapshot view-state in
  `window-registry.ts`, dispatch through `lib/room-tools.ts`).
- Voice: Web Speech API native for STT, `/api/tts` proxy to Cartesia
  (preferred) or ElevenLabs (fallback). Deepgram stubbed at 501 —
  intentional.
- KG read path is live — `web/lib/api/backend.ts` + `web/lib/api/kg-to-graph.ts`
  talk to the unified FastAPI backend for the Graph room. This is new
  in `91a7d5b` so it's part of what may be regressing (see 3.3).

**Not working / known gaps**
- Recovery metric was "100% (vacuous)" pre-Sprint 1.5 and "0% truthful"
  after the fix — the agent doesn't retry on tool failures yet. Sprint
  2's goal was latency, not recovery; the retry work is still open.
- Chat mode is new enough that there's no eval run against it. The
  corpus was designed for the windowed mode (open/arrange/scroll/
  select/highlight). Chat mode's "`ui.room` swaps focused room" semantics
  will score differently.
- Sub-agent step cap was tightened for latency (4→3). Some multi-step
  queries may silently truncate. Sprint plan acknowledges this as a
  trade-off.

**Concerns**
- **The `91a7d5b` regression** (see §3.3).
- Architectural cost of two UIs in one app: the agent's tool semantics
  have to be aware of `uiMode`. Orchestrator prompt needs to learn
  "don't try to open a second window in chat mode" and "in chat mode,
  `open_brief` means *swap the focused room to brief*". If the prompt
  isn't updated, the canvas semantics will feel wrong in chat mode.
  Worth checking whether `c0592bc` updated the orchestrator prompt —
  per `91a7d5b` diff, `lib/agent/orchestrator.ts` was touched but
  primarily for mount-point changes, not for uiMode awareness.
- Two `/api/agent/*` routes still coexist per `agent-evals/AGENTS.md`:
  `/api/agent/orchestrate` (current) and `/api/agent/stream` (legacy,
  marked for Sprint 0 deletion). Your local snapshot shows both still
  present on `feature/ui-iteration-v1`. Worth confirming the legacy route
  is actually gone on `origin/main`.

**Positives**
- This is by far the most polished surface. Design tokens, motion,
  room vocabulary, snapshot shape, eval harness, capability sprints —
  it's a mature process with real metric deltas per PR.
- Eval harness (`web/agent-evals/`) is a durable asset: 80-query
  corpus, rules + Devin judgement, deterministic metrics. Re-usable for
  any future agent that drives this UI.
- Chat mode's design call — *same agent, same tools, just a different
  layout with persistent history* — is the right call. It avoids
  spinning up a parallel chat agent and keeps the eval corpus relevant.

### 3.3 The `91a7d5b` "regressing" commit

This is what your friend is stuck on. Commit authored `2026-04-26
02:57 +01:00`, message `feat: UI windowed and chat based, regressing`,
trailer `Made-with: Cursor`. Twenty-three files touched, +2031/-148.

What it adds:

- **`web/components/rooms/IntegrationRoom.tsx`** (787 lines, new). One
  window per Composio toolkit slug (`slack / github / gmail / linear /
  ...`). Five states: missing user_id → skeleton → ACTIVE (KG slice
  visible) → INITIATED (waiting for OAuth consent) → disconnected
  (connect button, OAUTH2 popup vs API_KEY inline form). Registers
  room-tools under shared `kind="integration"` routed by `args.slug`.
- **`web/lib/api/backend.ts`** (392 lines, new) — FastAPI client
  wrapper for the unified backend.
- **`web/lib/api/kg-to-graph.ts`** (164 lines, new) — maps KG nodes
  into the graph-room visual schema.
- **`web/app/oauth/return/page.tsx`** (84 lines, new) — OAuth callback
  handler.
- **`app/routes/api_composio.py` +73 / `app/services/composio.py` +56** —
  backend changes to support hosted OAuth from the browser.
- Smoke tests: `web/tests/backend-api-smoke.mjs`,
  `web/tests/windowed-mode-tools-smoke.mjs`. Two new `.mjs` files.
- Modifies `store.ts`, `orchestrator.ts`, `server-snapshot.ts`,
  `snapshot.ts`, `tools.ts`, `types.ts`, `CommandBar.tsx`,
  `FloatingDock.tsx`, `StoreBridge.tsx`, `window-registry.ts`,
  `mount-points.ts`.

Plausible causes of "regressing" (to be verified by actually running
the app):

1. **Orchestrator / snapshot drift** — adding an IntegrationRoom kind
   plus a new top-level uiMode means the agent's snapshot has to
   describe both, and the layout/content prompts need to know what to
   do with `integration` windows. If the prompt-side updates
   under-shot the snapshot-side changes, the agent will start emitting
   tool calls that fail on the client (e.g. `open_room("integration")`
   without a `payload: {slug}` shape).
2. **Tool-name or dispatch mismatch** — the `integration` room uses
   slug-routed tool dispatch (`args.slug` switch). If the dispatcher in
   `lib/room-tools.ts` was updated but the orchestrator emits the old
   flat tool name, nothing fires — you'll see `agent.tool.start` /
   `agent.tool.done` events with `ok: false`.
3. **OAuth popup return path** — `/oauth/return` has to postMessage or
   mutate the store; a timing bug here would leave the integration
   stuck in `INITIATED` forever, which matches "waiting for consent…"
   persistence.
4. **Backend URL config** — `web/lib/api/backend.ts` reads a base URL.
   If that's left pointing at localhost:8000 on a production deploy,
   all backend calls will fail silently behind CORS.

Commit `1d152ef fix: agent latency UI` came 17 minutes later and only
touches orchestrator / content-agent / store / CommandBar / dock /
Onboarding — it does **not** obviously address the integration-room
regression.

**Ask the friend: does the regression manifest in both modes, or
specifically when opening an integration window?** The answer
localises the fix to orchestrator-prompt vs tool-dispatch vs OAuth
return.

### 3.4 Daud — `render_sdk/` (unchanged)

- `render_sdk/` is the standalone package that deploys a local folder
  to Render as a Web Service. Jordan's `01-findings.md` is explicit
  that the harness v0/v1 does **not** lift this — different primitive
  (Web Service vs Workflows) and naming collision with PyPI's
  `render_sdk`.
- Nothing new on it in the last 55 commits on `origin/main` as far as I
  can see. It's finished for the MVP path you're on.

### 3.5 KG / pipeline — shipped

- `docs/agent-harness-integration.md` (already in your local
  snapshot) is the canonical integration guide for *consumers* of the
  KG MCP. It references `https://kg-mcp-2983.onrender.com/mcp` which
  currently returns **404 on all paths** — that deployment is dead.
- The unified backend (commit `abdaa05`+) is the successor. The doc
  needs updating to point at whatever the new service URL is (or the
  app/main.py locally). Worth doing before anyone else tries to wire
  in.
- 40 memories, 19 skills, 3 workflows, 18 wiki pages — all in
  SurrealDB per the agent-harness-integration doc.

---

## 4. Action list (ordered)

### P0 — unblock the team today

1. **Get onto `origin/main`.**
   `git pull --ff-only` in this repo.
   `git pull` in `.worktrees/desmond-ui`.
   Ignore the Jordan worktree — it's on its own branch.

2. **Debug the `91a7d5b` regression.**
   Ask the friend which symptom he's seeing. If he doesn't have a
   repro, do it yourself: check out `91a7d5b` in a clean worktree, run
   `cd web && npm install && npm run dev`, open `/`, toggle into chat
   mode, click into Integration/Settings, try to connect a Composio
   toolkit, watch the browser console and the FastAPI backend logs.
   Start with hypothesis 2 (tool-name dispatch) — cheapest to falsify.

3. **Smoke Jordan's harness once.**
   ```
   cd agent/.worktrees/jordan-microbot_harness_v0/agent/harness/frontend
   # confirm agent/.env has ANTHROPIC_API_KEY
   npm install && npm run dev
   # new shell
   cd ../../../scratchpad/p1-harness-mvp/tests
   npm install && npx playwright install chromium
   npx playwright test v0-smoke.spec.ts
   ```
   Either commit a green run or commit the failing report.
   `02-v0-v1-contract.md` requires test evidence, not vibes.

4. **Update `docs/agent-harness-integration.md`** to stop pointing at
   the dead `kg-mcp-2983.onrender.com`. Either point at the new unified
   backend URL or mark the integration path as "run `app/main.py`
   locally, talk MCP to `http://localhost:<port>/mcp`" until
   redeployment lands.

### P1 — decide the integration story this weekend

5. **Pick a home for Jordan's chat-coding-agent.** Three realistic
   options:

   a. **Keep it as a separate third surface** (`agent/harness/frontend/`
      stays its own Next.js app). Fast. Ships. Clear DRI. But loses
      Desmond's rooms, voice, KG, eval harness, Composio.

   b. **Fold it into Desmond's chat mode** — the chat panel already has
      persistent history and a single embedded room; add a
      "Code Interpreter" room whose backend is Jordan's `/api/chat`
      (or a new `/api/code-chat`) with the 4 inline tools. The
      orchestrator delegates to it when the user wants code
      executed. Preserves the windowed+chat duality; reuses eval
      harness.

   c. **Replace Desmond's chat-mode backend with Jordan's harness.**
      Probably wrong — you'd lose the orchestrator/layout/content
      pattern and the rooms vocabulary.

   Preference, given where everything sits: (b), gated on
   `integration` regression being fixed first.

6. **Reconcile the LLM providers.** Harness = Anthropic Sonnet 4.6.
   UI = OpenRouter Gemini Flash-Lite (locked per
   `web/agent-evals/AGENTS.md`). If (b) happens, the code-exec room
   probably stays on Anthropic (better tool-use for coding) and the
   UI agent stays on Flash-Lite. Write this down somewhere durable
   (in `web/agent-evals/AGENTS.md` and in Jordan's spec) so nobody
   bake-offs either accidentally.

7. **Decide the MCP-vs-inline boundary for the harness.** Jordan's
   v2 plan is to move the 4 tools off `/api/chat` and into the MCP
   server. That's fine but it only matters if another client (Claude
   Desktop, Cursor, Desmond's UI) is going to consume the harness
   tools. If (5b) is picked, the answer may be "never" — the tools
   live inline in a Next.js route forever.

### P2 — backlog, not blocking demo

8. Render Blueprint coverage for the harness frontend + Workflows
   service. Currently only the MCP service is in `render.yaml`.
9. Postgres chat-history persistence in the harness. v0/v1 is
   in-memory.
10. Recovery metric in the UI eval harness — agent doesn't yet retry
    on failed tool calls. Sprint 2 didn't ship it; next sprint should.
11. Eval corpus coverage for chat mode (separate from windowed mode).
    Semantics of `ui.room` / `ui.arrange` differ in chat mode; the
    existing rules don't reflect that.
12. Fate of the dead `kg-mcp-2983.onrender.com` — redeploy the
    unified backend to that URL or retire the URL and rename the
    service.
13. `run_user_code` Workflows task stub needs implementing whenever
    Phase 2 of the harness starts.

---

## 5. Concerns (stand-alone)

- **Architectural drift between the three surfaces is growing faster
  than integration work.** Windowed UI, chat UI, and harness each got a
  meaningful feature in the last 24 hours; none of them have landed
  shared contracts. The longer this continues, the more painful the
  merge.
- **"Made-with: Cursor" commits are shipping without test runs.** The
  `91a7d5b` commit adds 2k lines, introduces OAuth, and is titled
  "regressing". Smoke files (`backend-api-smoke.mjs`,
  `windowed-mode-tools-smoke.mjs`) were added but I see no evidence
  they ran green before the commit landed. Cursor's autonomy works
  better when the smoke loop is actually part of the habit.
- **Only one person is driving tests.** Jordan's Playwright tests exist
  but are unrun. Desmond's eval harness exists and runs per-sprint but
  doesn't cover chat mode. The repo needs a shared "test gate" before
  the demo to avoid each surface being individually green but
  collectively broken at integration time.

## 6. Positives (stand-alone)

- Both UIs are further along than "prototype". The dock, command bar,
  chat panel, graph canvas, window frame, card stack, and onboarding
  are production-quality on `origin/main`.
- The harness spec discipline (`p1-harness-mvp/plan/01-findings`,
  `02-spec`, `03-handoff`, `notes/00-cold-start`,
  `notes/02-v0-v1-contract`) is excellent — a new agent can pick it up
  cold and know exactly what to build.
- The unified FastAPI backend collapsing MCP + REST + Composio OAuth
  into one deployable URL is the right move. It removes half the
  integration surface.
- KG pipeline is live and has real data (40 memories, 19 skills, etc.)
  — downstream agents have something meaningful to read against, not
  empty tables.
- Eval harness on the UI side (`web/agent-evals/`) is a durable asset
  you'll reuse well past this hackathon.

---

## 7. Where this doc lives

`docs/triage-2026-04-26-ui-harness-sync.md` — sits next to the other
cross-cutting docs (`agent-harness-integration.md`, `api-reference.md`,
`feature.md`, `logging.md`). Feel free to delete after the next team
sync; it's a snapshot, not a spec.

If the regression gets fixed today and the team picks an integration
option from §4.5, this doc is done. Otherwise append a dated section
at the bottom with the decision log rather than editing the body —
snapshots age badly if rewritten in place.
