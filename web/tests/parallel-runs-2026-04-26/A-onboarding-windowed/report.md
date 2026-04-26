# A — Onboarding + Windowed Mode

## Summary

**Partial.** Onboarding, the user_id save flow, and the spotlight bar are all
solid — those steps every passed cleanly with the right toast/chip and a
persisted `microbots:userId`. The agent itself is the weak spot: in 5 queries,
the only one that actually mutated the canvas was `"what's broken in my stack"`
and even that one fired six (!) `open_window(integration)` tool calls that all
landed at the exact same rect, producing a stack of identical windows with no
fan-out. The headline failure was `"show me the graph"`: the agent emitted the
literal text `open_window(kind="graph")\n` as its reply rather than invoking
the tool — so the graph window never opened despite `graph` being in the
windowed-allowed set. Two queries also exposed a stale-reply bug where the
dock keeps showing the previous query's text after the new query runs and
fires its tools, which means the user sees an apology while the canvas is
visibly executing a contradictory action.

## Objective findings

- **Agent emits tool call as text on `show me the graph`** → orchestrator
  → `agentReply` ends up containing the string `open_window(kind="graph")\n`,
  no `agent.tool.start` event ever fires, no graph window opens. Reproduced in
  both runs. WHERE: `web/lib/agent/orchestrator.ts` system prompt + flash-lite
  tool-calling reliability. EVIDENCE:
  `query-log.json` q02 (`reply='open_window(kind="graph")\n'`,
  `newActions: []`, `opened: []`), `screenshots/q02-show-me-the-graph-after.png`.

- **Stale reply lingers in dock when next query fires no `reply.start`** →
  q04 ("list services") and q05 ("what's broken in my stack") both display
  `i can't open workflows in windowed mode.` in the dock — the reply from q03.
  Specifically q05 *opens 6 integration windows mid-stream* but the dock
  never re-narrates the new turn. WHERE: orchestrator either omits
  `reply.start`/`reply.chunk` for tool-only turns, or
  `agent-client.ts:applyAgentEvent` doesn't reset `agentReply` on
  `agent.delegate`/`agent.tool.start`. EVIDENCE: `query-log.json` q05 reply
  vs `newActions` length=6. `screenshots/q05-what-s-broken-in-my-stack-after.png`.

- **Agent self-contradicts on q05** → reply says `i can't open workflows in
  windowed mode.` while the same turn fires
  `open_window(integration, slug=linear)`,
  `open_window(integration)`,
  `open_window(integration, slug=notion)`,
  `open_window(integration)`,
  `open_window(integration, slug=perplexityai)`,
  `open_window(integration)`. EVIDENCE: `query-log.json` q05 `newActions`.

- **6 integration windows stack at exactly the same rect** — every opened
  integration window ends up at `{x:738,y:21,w:666,h:778}`. No jitter, no
  orbit-the-focus offset, no fan-out grid. Violates "edges should not align
  across windows" + "demoted windows orbit the focus" from
  `web/agent-evals/AGENTS.md` layout principles. WHERE: layout-agent never
  ran (orchestrator only fired content `open_window` chain). EVIDENCE:
  `run.log` "windows before drag: ... [6× same rect]".
  `screenshots/q05-what-s-broken-in-my-stack-after.png`.

- **No-slug integration calls don't dedupe** — three of the six
  `open_window(kind=integration)` calls had no slug, yet they each opened a
  *new* window. The store's `openWindow` code (`web/lib/store.ts:489`) is
  supposed to dedupe by `(kind, payload.slug)` and treat
  `slug === undefined` as a single key, but in practice three slug-less
  calls produced three distinct windows. EVIDENCE: `query-log.json` q05
  `newActions` (3 of 6 have no slug); store inventory afterwards has 6
  integration windows. Likely the orchestrate route is putting `slug` in
  `args` directly instead of `payload`, so dedupe always misses.

- **`graph` room registers a tool 'clear' with no implementation** → console
  warning `[room-tools] no tool 'clear' on room 'graph'`. WHERE:
  `web/lib/room-tools.ts` (some agent path is asking for a `clear` tool that
  was never registered). EVIDENCE: `console-errors.json` entry 1.

- **Knowledge-graph entities endpoint returns 422** — two `GET
  https://app-bf31.onrender.com/api/kg/entities` calls during the run
  returned 422 (unprocessable entity). The frontend silently swallows them
  but the snapshot agent thinks the backend is degraded. WHERE: backend
  contract for `/api/kg/entities` likely missing required query param.
  EVIDENCE: `console-errors.json` entries 2 & 3.

- **`q01 morning brief` has no graceful fallback** — windowed mode rejects
  `brief` (only graph/settings/integration are allowed per
  `tests/windowed-mode-tools-smoke.mjs`), but the agent's response is a
  bare `briefs are not available in windowed mode.` toast — no offer to
  switch to chat mode, no card with the proposal summary, no "open settings
  to flip" affordance. WHERE: `web/lib/agent/orchestrator.ts` refusal
  prompt. EVIDENCE: `query-log.json` q01.

- **No `ui.card` (memory/entity/source/diff) ever pushed across the entire
  run** — the only card was the `toast` from `settings_user_id_save`. The
  AGENTS.md plan explicitly expects performative chains that "push memory
  card with rate-limit context". Five queries, zero cards. EVIDENCE:
  `query-log.json` `newCards` is empty for all 5.

## Subjective findings

- **Spotlight auto-dismiss in windowed mode is opinionated and a little
  jarring.** After a query lands, the bar slides away on a 350 ms timer
  whether or not you're done reading. If the agent's reply is one line
  ("i can't open workflows in windowed mode."), it disappears almost
  immediately — you have to look at the FloatingDock to re-read it. Felt
  off because the user has no signal that the dock will narrate the rest;
  the spotlight just eats your attention then bails.

- **Onboarding-dot copy → settings is a small bait-and-switch.** The hint
  copy says "press and hold the dot, then tell me about your day", which
  primes a voice / status interaction. A click instead opens an "identity"
  settings room with a `user_id` form field. The chained motion is fine,
  but the verbal contract ("tell me about your day") doesn't match the
  visual contract (a uppercase form). Felt off because the onboarding
  promised a conversational moment and immediately delivered config.

- **The "saved" chip uses tone-high (green-ish)** but reads like a state
  badge — there is no animation or in-out fade when the value flips from
  `unset` → `saved`, so the only confirmation the user gets is the toast
  card. If the toast scrolls past unnoticed, the chip change is too quiet
  to read as success.

- **The dock has nothing on it.** No room icons, no quick-launch, no
  history. Just the voice dot on the left, narration text in the middle,
  chat-mode toggle on the right. For a windowed-mode interface where the
  agent is nominally in charge, the dock is the most undersigned-around
  surface — every escape from agent-as-router runs through `/`, and that's
  fine, but it feels like the dock is *waiting* for icons that were
  removed without a replacement affordance. Even one "settings" icon to
  flip back to identity would help.

- **`SnapshotInspector` is hidden behind ⌘⇧S with no obvious hint.** The
  `agent · snapshot` chip in the top-left tells you the inspector exists
  *only after* you discover the keyboard shortcut once. For a debug panel
  that's *the* trust-building UI for the harness ("here's what the agent
  sees"), it should be discoverable from the dock.

- **Agent replies feel canned, not crafted.** Every refusal is the same
  shape ("i can't ___ in windowed mode."). The orchestrator system prompt
  appears to be returning a stock string for windowed-mode rejections
  instead of giving a useful next step. Felt off because the user is
  *reasonably* asking the agent for things ("morning brief", "list
  services") and getting back what reads like an HTTP 405 error.

## Harness-merge implications

The current windowed UI agent is already structured around a 4-window
canvas and tool-firing through SSE — Jordan's harness shape (4 tools:
`run_code`, `find_examples`, `save_workflow`, `ask_user`, per
`scratchpad/p1-harness-mvp/plan/02-spec.md` v0/v1 contract) maps onto it
in a few specific places.

Concrete affordances where the merge should land:

- **The Spotlight command bar** (`web/components/command/CommandBar.tsx`)
  is the natural surface to *also* expose `ask_user` from a code-interpreter
  turn. Right now `Ask_User_A_Question` is "client-resolved" in the harness
  spec — the spotlight is exactly that client. Concrete change: when the
  agent emits an `ask_user` SSE event, render it as a tucked-state card
  with the question + options (pickable inline, or free-text via the same
  input that submitted the query). The `tucked` phase already does the
  90% of this layout work.

- **`SnapshotInspector` (left-side drawer)** is the natural home for the
  `run_code` cell view. The spec calls for a ChatGPT-Code-Interpreter shape:
  generated code → run → stdout/stderr/result. The inspector already shows
  per-tool rows from `recentActions`. Wire `run_code` so its row in the
  inspector expands to a code block + collapsible stdout pane; reuse the
  existing `font-mono text-[10.5px]` chrome. This avoids new components and
  keeps the "what the agent sees / what the agent did" panel coherent.

- **`q05` integration-window stack is screaming for `find_examples`**.
  The agent fired six raw `open_window(integration)` calls because it had
  no notion of "search the templates". `find_examples(query)` returning
  `[{slug, title, summary}]` lets the layout-agent pick *one* integration
  to open as the subject and pip the rest, instead of stacking six.
  Concrete change: register `find_examples` as a tool the orchestrator can
  call before any `open_window` chain; the result becomes a ranked list it
  uses to decide how many windows to open and in what mounts.

- **`save_workflow`** maps cleanly onto the existing `playbooks` room —
  the agent could promote an ad-hoc multi-step run into a saved workflow.
  Concrete change: add a `save_workflow` button next to each workflow step
  in `WorkflowRoom.tsx`, and have the agent emit a `ui.tool` event
  targeting it after a successful `run_code` chain. This replaces the
  current "I can only open graph, settings, or integration windows" dead
  end on `"open the bug triage workflow"` — the agent could run the
  workflow steps in `run_code`, then offer to save the result.

- **The stale-reply bug above is exactly where harness-style "tool turns"
  vs "speech turns" diverge.** A code-interpreter agent regularly does
  long tool-only turns with no speech token between them. The current
  client doesn't reset `agentReply` on `agent.tool.start`, so the dock
  stays stuck on the previous turn's apology. This must be fixed BEFORE
  the merge or the harness shape will look broken on every long turn.

What makes the merge **easier**:

- The SSE event vocabulary in `web/lib/agent-client.ts` already includes
  `agent.tool.start`/`agent.tool.done`/`agent.tool.retry` — tagging
  `run_code` and `find_examples` as new tool names is a one-line union
  extension, no new event type needed.
- The `ui.card` event type covers `memory|entity|source|diff|toast` —
  adding a `code` or `examples` kind for harness-shape outputs is a
  trivial enum widening.
- `recentActions` ring buffer caps at 6, exactly matches a multi-step
  code interpreter loop length.

What makes the merge **harder**:

- The windowed-mode allow-set is hard-coded to `{graph, settings,
  integration}` (`web/tests/windowed-mode-tools-smoke.mjs`). The harness
  spec doesn't really map onto rooms — it's a code-interpreter that
  doesn't need a room at all. Either we widen the windowed allow-set to
  include a new `code` or `harness` kind, or harness-mode lives outside
  the room metaphor (probably the latter, in the SnapshotInspector or a
  dedicated drawer).
- The agent's tool-call-as-text bug on `q02` is a model reliability
  issue — it'll affect harness tools the same way unless the
  orchestrator system prompt is hardened. This is the same class of
  failure as the marginal-intent regressions in the AGENTS.md sprint
  plan; ship Sprint 1's "snapshot & context engineering" before merging
  or the harness will inherit the brittleness.
- The 6-window stack on q05 means there is currently *no* layout
  contract that says "if you open more than N integration windows, fan
  them out". Before adding `run_code` (which can spawn even more
  output), need a "demoted windows orbit the focus" enforcer at the
  store layer or layout-agent layer.

## Per-query log

| query | tool calls observed | room opened | card pushed | took (s) | felt right? |
|---|---|---|---|---|---|
| morning brief | none | none | none | 8.2 | **n** — 8 s to spit out a one-line refusal; no offer to flip to chat mode where brief works |
| show me the graph | none (text-only reply `open_window(kind="graph")\n`) | none | none | 1.2 | **n** — graph IS allowed in windowed mode; agent emitted the tool call as text instead of invoking it. Headline bug. |
| open the bug triage workflow | none | none | none | 4.5 | **partial** — refusal is correct (workflow not in windowed allow-set), but no fallback (no "open this in chat" link, no workflow card with the steps) |
| list services | none | none | none | 8.0 | **n** — agent never settled within 8 s; dock still in `thinking`; reply still reads "i can't open workflows" from the previous turn |
| what's broken in my stack | 6× open_window (linear, ∅, notion, ∅, perplexityai, ∅) + delegate_content | 6× integration (all stacked at same rect) | none | 13.9 | **n** — agent contradicts itself: opens 6 integration windows but reply says "i can't open workflows in windowed mode." (stale from q03). Layout fan-out is broken. |

Auxiliary checks:

| check | result |
|---|---|
| onboarding-dot click → settings opens | **pass** (`screenshots/02-after-onboarding.png`) |
| `user_id` save → `saved` chip + toast card + `microbots:userId` set | **pass** (toast `kind:"toast"` in store; `saved` chip rendered) |
| `/` opens spotlight | **pass** |
| direct dock → click a room icon | **n/a** — no room icons exist on the FloatingDock; dock has voice-dot + chat-mode toggle only (intentional per `FloatingDock.tsx` comment) |
| drag opened window by title bar ~100 px | **pass** (after first targeting topmost-by-zIndex; clamped to viewport from 100 px requested → 20 px actual on x because the integration window was already against the right edge) |
| `SnapshotInspector` mid-flight screenshot | **partial** — captured but my dual-key fallback (Meta+Shift+S then Control+Shift+S) toggled the panel twice and may have left it closed; chip state visible in `screenshots/05-snapshot-inspector-midflight.png` either way |

Full telemetry in this directory:
`run.mjs` (the script), `run.log`, `query-log.json`, `console-errors.json`,
`network-failures.json`, `orchestrate-log.json`, `screenshots/01..09 + q01..q05`.
