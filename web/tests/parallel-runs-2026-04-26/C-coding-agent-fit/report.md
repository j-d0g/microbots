# C — Coding-agent-shaped tasks: harness fit assessment

Run date: 2026-04-26 · 5 queries × (windowed | chat) · headless Chromium 1440×900 · `claude-sonnet-4-6` not in the loop here — this is the OpenRouter-Gemini-Flash-Lite UI agent (orchestrator + content sub-agent) at `/api/agent/orchestrate`.

Artefacts in this folder:
- `probe.mjs` — the script (run with cwd=`web/`)
- `screenshots/00-…99-*.png` — pre/during/after for each query + final dock + Stack/Workflow rooms
- `console-errors.json` — 1 React-devtools info, 2 KG-backend 422s, 1 `[room-tools] no tool 'connect' on room 'integration'` warning
- `network-failures.json` — both 422s point at `https://app-bf31.onrender.com/api/kg/entities`
- `per-query.json` — full store snapshots (windows / cards / chatMessages / recentActions) for each query
- `sse-samples.json` — orchestrate POSTs (200 each, no failures)

## Summary

The gap is large and obvious: today's UI agent is a **stage manager** that opens windows, surfaces transient cards, and refuses anything code-shaped. Across the 5 coding-agent-shaped probes, the orchestrator did exactly **zero** code executions, **zero** URL fetches, **zero** workflow drafts that produced actual code, and **zero** `ask_user` confirmation prompts. Twice (queries 2 + 3) it explicitly toasted "I can't do this." Once (query 4) it teased a `Draft ready · python script…` diff card with no code visible. Once (query 5, "post slack 'hello team'") it skipped any confirmation and jumped straight to opening a Composio OAuth window — a destructive-action shape with no `Are you sure?` gate, plus a tool-dispatch bug. The harness's 4 tools (`run_code`, `find_examples`, `save_workflow`, `ask_user`) map onto **zero** existing UI affordances. Each one is a clean greenfield addition. The UI is well-suited to *host* them — Stack room is the natural home for `run_code` results / service inspection, Workflow room for `save_workflow` outputs, the chat-mode reply lane for `find_examples` previews, and the `ask_user` client-resolved prompt is a simple modal/card kind that doesn't yet exist.

## Objective findings

What exists today (and what fired against the probes):

- **Orchestrator surface** (`web/lib/agent/orchestrator.ts`): `open_window`, `close_window`, `focus_window`, `arrange_windows`, `clear_canvas`, `delegate_content`. None of these can run code, fetch a URL, tail logs, or persist a snippet. Every probe except #1 ended in `delegate_content`; #1 was `delegate_content` with no follow-up tools called.
- **Content sub-agent** (`web/lib/agent/content-agent.ts`): `push_card(kind, text, …)` (kinds: memory, entity, source, diff, toast), `highlight`, `explain`, `compare`, `draft`, `integration_connect(slug)`, plus per-room tools (`brief_*`, `stack_*`, `workflow_*`, …). The sub-agent's *only* code-shaped tool is `draft(topic)` which produces a **diff card** with a one-line summary string and a confidence number — no code body, no save target.
- **Stack room** (`web/components/rooms/StackRoom.tsx`): a static read-only grid of 7-ish seeded services from `web/lib/seed/ontology.ts`, each with a hand-written `fakeLogs(slug)` array. Tools: `filter`, `clear_filters`, `select`, `deselect`, `scroll_to`. No "tail logs", no "exec", no "redeploy", no "open service in editor".
- **Workflow room** (`web/components/rooms/WorkflowRoom.tsx`): static seeded workflows (bug-triage, weekly-founders-update, pr-reminder) with prose `steps` arrays, optional DAG view, optional plain-english "recipe" view. Tools: `filter`, `select`, `back`, `show_dag`, `show_recipe`, `toggle_view`, `scroll_to`, `highlight`. No editor, no deploy, no "save current draft as workflow", no Python anywhere.
- **FloatingDock** (`web/components/dock/FloatingDock.tsx`): voice dot · narration text · chat-mode toggle. That's it. **No code/interpreter/execute affordance anywhere on the dock.** (Verified visually in `99-floating-dock.png`.)
- **CommandBar** (`web/components/command/CommandBar.tsx`): a one-line spotlight input. Suggestions are all open-window verbs ("morning", "show me the graph", "draft the friday update"). **No `/run` / `/exec` / `/code` slash command.**
- **Chat mode** (`ChatLayout` = chat panel + single embedded room): chat panel renders streaming `reply.chunk`s as agent messages, plus a tab strip for the 7 chat-mode room kinds. **No code-rendering surface, no copy-code button, no `play` button on agent messages, no diff card with executable preview.**

Queries that fell flat (`per-query.json` has the raw store after each):

| query                   | mode    | recentActions emitted                                                                                                                       | user-visible result                                                                                |
|-------------------------|---------|---------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| 01 maths (7²)           | windowed | `delegate_content`                                                                                                                          | empty — no card, no toast, no chat reply, no window. The agent silently no-op'd.                   |
| 02 fetch+wordcount      | chat    | `delegate_content` → `push_card(toast)`                                                                                                     | toast: "I can't fetch external URLs or count words. I can only work with the information you provide or tools I have access to." |
| 03 slowest service+logs | windowed | `open_window(brief)` × 1, `open_window(graph)` × 2, `delegate_content`, `push_card(toast)`                                                   | toast: "I can't determine the slowest service or access logs with the available tools." Plus 2 × KG `/api/kg/entities → 422`. **It opened brief+graph rooms but never opened the actual `stack` room** (windowed mode forbids `stack`).  |
| 04 python+slack 9am     | chat    | `delegate_content` → `draft(topic="python script to send a slack message every morning at 9am")`                                            | diff card: `Draft ready · python script to send a slack message every morning at 9am` (confidence 0.86). **No code body anywhere.** |
| 05 post slack #general  | windowed | `delegate_content` → `integration_connect(slug=slack)` → `open_window(integration)`. **No `ask_user` call.** Console warning `[room-tools] no tool 'connect' on room 'integration'`. | The Slack integration window opens. The user is asked to OAuth, **not** asked "do you really want to send 'hello team' to #general?" The original message text is dropped on the floor. |

Two structural issues showed up alongside the "harness gap" theme:

- **`open_window(brief)` succeeds in windowed mode** despite the kind-gate that should refuse `brief` (`web/tests/windowed-mode-tools-smoke.mjs` asserts this). Query 3 produced a `brief` window in windowed mode. Probably tied to the `91a7d5b` regression noted in `docs/triage-2026-04-26-ui-harness-sync.md`.
- **`integration_connect(slack)` triggers `[room-tools] no tool 'connect' on room 'integration'`** (query 5). Tool-dispatch mismatch — the integration room registers tools but not `connect` under that name. Same `91a7d5b` neighbourhood.

These aren't harness-fit problems, but they sit on the path the harness would walk into.

## Subjective findings

The "feel" is striking: every coding-shaped query lands in a quiet, polite refusal or a beautiful empty canvas. The agent never says "let me try" — it just opens a room (sometimes the wrong one) or fires a 4-second toast that fades. The query-4 draft card is the most disappointing: it animates in saying "Draft ready · python script…" with a confidence score, and there is **literally nowhere to click to see the draft**. It's a confidence number floating in space. A user would interpret this as "the agent did something" when in fact the agent just emitted a label and called it done.

Query 5 is the riskier shape: "post a slack message saying 'hello team'" should hit the destructive-action confirmation rule from the harness spec (and from upstream system-prompt principles per Jordan's `02-spec.md` line 110 — "Confirm before sending external messages, deleting data, or doing anything you can't undo"). The UI agent, by contrast, opens an OAuth window with no acknowledgement that the user wanted to send a specific message to a specific channel. A real send would never have been confirmed, even if the integration was wired.

The Stack room visual (`99-chat-room-stack.png`) is gorgeous — a clean column of services, health dots, deployedAt timestamps, log preview drawer. It feels exactly like the surface that *should* host "run a Python file → see the stdout/stderr/result" — except the data is hand-seeded fakeLogs and there's no exec button. Same with the Workflow room: a recipe + DAG view of three pre-baked workflows, polished, but read-only. You can feel the missing actions.

The CommandBar / chat input feel correct for "ask the agent to drive the canvas". They feel wrong for "give me the answer to 7²". For the latter, the user wants the answer in the bar (or in chat), not a window opened somewhere. Today the bar can render `reply.chunk` text — but the orchestrator delegates to content-agent, and content-agent's rule is **"never write prose. only call tools."** So the answer never streams; the bar just sits empty until the dock returns to idle and dismisses itself. Cold.

## The 4 harness tools — UI mapping today

For each tool, a one-line "where (if anywhere) does an analogous affordance exist" + "what's missing":

- **`run_code(code, args?) -> {result, stdout, stderr, error}`** → **No analogue.** Closest visual: the Stack room renders services with `logs: string[]` arrays and a "log drawer" UI affordance (per `select` / `deselect` tools). That's the natural home for code-output rendering — service-shaped cards with a stdout pane. Missing: any path from "agent has Python" to "Python runs" to "stdout shows here". The harness solves this with `subprocess.spawn("python3", ["-c", code])` per the v0/v1 contract; the UI has no card kind for that result and no place to display structured stdout/stderr/error/return-value.
- **`find_examples(query) -> [{title, source, …}]`** → **No analogue for code/template search.** Closest visual: the Workflow room's `filter(integration=…)` tool returns matching workflows from `seed.workflows[]`, and the Playbooks room has a `search` tool. But both search hard-coded ontology entries, not a template library, and there's no preview-source concept — the workflow `steps` are prose strings, not Python. Missing: a templates corpus + a "show source" preview pane. The cleanest mount is probably an inline list inside the chat reply (when run_code is the next intended call), not a new room.
- **`save_workflow(name, code) -> {url}`** → **No analogue.** The closest is the `draft` tool, which surfaces a `kind: "diff"` card with a text label — but the diff card is transient (it doesn't persist), it has no editor, and it has no "deploy"/"publish" state. The Workflow room has `select(slug)` + `back` tools that could *display* a saved workflow, and the Stack room has `services` (deployed code) — but nothing connects "agent generated this" to "this now lives at /workflows/foo". Missing: a card kind (or window kind) that takes `{name, code, url}`, renders the code, optionally registers a Stack `service` entry pointing at the saved URL. The harness already returns a mock URL (`https://example.com/workflows/<slug>`) — feed it into Stack as a deployed service.
- **`ask_user(question, options?) -> answer`** → **Strictly no analogue.** Toast cards are emit-and-forget. There is no modal/prompt/confirm primitive in `web/components/`. Even the integration OAuth flow uses a popup window, not an in-app prompt. Missing: a client-resolved prompt component (the harness already has `AskUserPrompt` in `agent/harness/frontend/app/page.tsx`; it's a minimal radio-button + free-text card). This is a **must-have** for any destructive-action gate, and it has zero infrastructure today.

## Concrete merge recommendation

**Where the code-interpreter affordance should live:** chat mode, with a single new room kind `interpreter` (a.k.a. "code"). Rationale below.

The smallest viable surface that lets the harness's 4 tools render usefully without redesigning the UI:

1. **A new room kind: `interpreter`** (registered in `web/components/stage/window-registry.ts`). Render-only spec: a top input ("type a task or paste code"), a stream of "execution cells" (each = `{code, stdout, stderr, result, status, ts}`), and a footer area for `ask_user` prompts when the agent is paused. In windowed mode, this is a window like `graph` / `settings`. In chat mode, it's an embeddable room — the chat panel already supports per-message `room` tagging so the room can swap in when the agent calls `run_code`.

2. **A new card kind: `code`** (extend `CardKind` in `web/lib/store.ts`). `data: {code, stdout, stderr, result, status: "running"|"ok"|"error", saveUrl?}`. This is what `run_code` results turn into. Stack room can subscribe to these cards and pin them on the relevant service column when the code references one (cute if cheap, skip if not).

3. **A new card kind: `examples`** (or piggyback on `source` which already exists). `data: {query, matches: [{title, source}]}`. Render in chat reply lane — the user sees a list of matching templates with collapsible source previews. Click → orchestrator calls `run_code` with that source as the seed.

4. **A new card kind: `prompt`** for `ask_user`. Client-resolved (the route returns the user's pick to the agent). Lift the `AskUserPrompt` component from `agent/harness/frontend/app/page.tsx`. Render inline in the chat panel (chat mode) or as a modal anchored to the `interpreter` window (windowed mode). **This unblocks the destructive-action gate today's UI is missing.**

5. **`save_workflow` output → Stack room.** Inserted as a synthetic `seed.services[]`-shaped entry: `{slug: <name>, version: "v0.0.1", purpose: "Saved by agent · <today>", runtime: "Python 3.12", health: "ok", schedule: "manual", logs: [<first stdout>], saveUrl: <mock URL>}`. The room already supports per-service log drawers; `save_workflow` just needs to push into that list. Future: deploy via Render Workflows = real service.

6. **Backend route**: add `/api/agent/code-chat` (or expand `/api/chat` lifted from the harness frontend). Reuses the harness's 4 inline tools. Anthropic-Sonnet for this room (better tool-use), OpenRouter-Flash-Lite stays on the orchestrator. This matches §4-option-(b) of `docs/triage-2026-04-26-ui-harness-sync.md`.

**Smallest possible delta** if you're optimising for time-to-merge:
- 1 new room kind (`interpreter`)
- 2 new card kinds (`code`, `prompt`)
- 1 new `/api/agent/code-chat` route (paste of `agent/harness/frontend/app/api/chat/route.ts` adapted to AgentEvent SSE shape)
- Orchestrator gets one new tool: `delegate_code(intent)` that opens the interpreter room and proxies the chat to `/api/agent/code-chat`

That's ~3 files added, 2 files modified. No redesign. Existing 80-query eval corpus is untouched (it tests stage-manager queries, not coding queries — add a small coding-query addendum later).

## Per-query log

| query | UI agent did | UI agent score 1–5 | harness would have | harness's gain |
|-------|-------------|---------------------|---------------------|----------------|
| compute the square of 7 (windowed) | `delegate_content` → no card, no toast, no reply, empty canvas. 4.4s wall-clock for a no-op. | **1** — silent failure | `run_code("print(7**2)")` → `{stdout: "49\n", result: 49}` | 49 in the bar in <2s |
| fetch https://example.com and count words (chat) | `delegate_content` → `push_card(toast)`: "I can't fetch external URLs or count words…" 5.8s. | **1** — explicit refusal | `run_code` step 1 → `httpx.get("https://example.com").text` then `run_code` step 2 → BeautifulSoup parse + word count | classic two-step harness path; ~6s end-to-end |
| find slowest service + logs (windowed) | Opens `brief` (gate-bypass bug) + `graph` (×2), delegates content, toast: "I can't determine the slowest service or access logs with the available tools." Also 2 × KG-backend 422. 5.7s. | **2** — opened the wrong rooms, then refused; the `stack` room with the answer was never opened | `find_examples("tail logs")` → returns a `tail_logs` template, then `run_code` against the seeded service → stdout streams into Stack-room log drawer | The Stack room finally earns its log column; user sees "actually here's the slowest one and its tail" instead of "I can't" |
| draft a python script that sends slack at 9am (chat) | `delegate_content` → `draft(topic=…)` → `kind:"diff"` card "Draft ready · python script…" (confidence 0.86). **No code body anywhere.** 4.1s. | **2** — teases a draft, never shows it | `find_examples("slack daily 9am")` → returns the seeded `slack-ping` template; agent shows code, asks `ask_user("Save this as a workflow?", ["yes", "edit", "no"])`; on yes, `save_workflow("morning-greet", code)` → URL pinned in Stack | User leaves with an actual reusable script, not a confidence number |
| post slack to #general saying 'hello team' (windowed) | `delegate_content` → `integration_connect(slack)` → `open_window(integration)`. Console: `no tool 'connect' on room 'integration'`. **No confirmation prompt.** Message text dropped. 13.3s. | **2** — destructive-shape with no gate; tool-dispatch bug en route | `ask_user("Send 'hello team' to #general?", ["yes", "no"])` BEFORE `run_code(slack_post(...))`. If integration not connected, `ask_user("Connect Slack first?")` → integration_connect | The exact destructive-action gate the harness spec mandates; user can't accidentally send the wrong message to the wrong channel |

Average UI-agent score across the 5 coding-agent-shaped probes: **1.6 / 5**. Average expected harness score on the same probes (per the harness's verified v0/v1 contract): **4–5**, conditional on `run_user_code` Phase 2 actually being implemented (currently a stub returning `{"error": "not implemented yet"}` per the triage doc).
