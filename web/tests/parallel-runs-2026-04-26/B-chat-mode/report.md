# B — Chat Mode + Mode Toggle

## Summary

Chat mode renders, persistent history works, and the mode toggle preserves
context cleanly in BOTH directions (windowed→chat inherits the topmost
window's room; chat→windowed promotes the focused room into a window).
That mechanical scaffolding is solid. **The chat-as-conversation experience
is broken**, though: 4 of the 5 test queries left an empty agent slot in
the history because the orchestrator only emits `reply.chunk` when the LLM
chooses to produce text, and Gemini Flash-Lite frequently chooses tools
without any narration. Two of those replies were even worse — Q3 produced
no events at all (silent agent), Q5 emitted the literal string
`open_window(kind='brief')\ndelegate_content(...)` *as the reply text*, i.e.
the model wrote out the tool syntax instead of calling the tools. So as a
"regular chat", chat mode currently feels like a one-way speaker tube: you
talk, sometimes a window swaps on the right, the chat panel goes silent.
The right pane DID swap rooms when tools fired, the toggle round-trip
(chat→windowed→chat with a brief opened in between) correctly hands the
focused room back and forth, and edge cases (empty submit, mid-flight
double-submit) behave defensively. The chat panel itself is sleek; it just
needs the orchestrator to actually narrate, and it needs to render tool
invocations + room swaps inline so the user understands *why* the right
pane changed.

## Objective findings

- **WHAT**: Agent message slot is missing for queries that resolve via
  tool calls only (no reply.chunk).  
  **WHERE**: `web/lib/agent-client.ts:121-143` (`reply.start` is the only
  event that pushes a fresh `agent` message into `chatMessages`); orchestrator
  `web/app/api/agent/orchestrate/route.ts:94-103` (`emit reply.start` only
  fires inside the textStream loop, so if the LLM produces zero text the
  user never gets an agent message).  
  **EVIDENCE**: Per-query log in `test-data.json` shows
  `replyLength: 0, reply: ""` for queries 2, 3, 4. Server-side curl probe
  confirms the orchestrator emitted `agent.delegate` + `agent.tool.start` +
  `ui.room` + `agent.tool.done` and *no* `reply.start`. The chat history
  ends up with 5 user messages and only 2 agent messages (Q1's "good
  morning to you too!" and Q5's broken `open_window(kind='brief')` text).

- **WHAT**: Q3 ("open the workflow for triaging bugs") produced ZERO
  output events from the orchestrator — no tools, no reply, no room swap.  
  **WHERE**: orchestrator output is empty per direct curl probe; the
  prompt (`web/lib/agent/orchestrator.ts:49`) explicitly *forbids* opening
  workflow in windowed mode but the snapshot was `mode: "chat"`. So this
  is a model failure, not a guardrail rejection.  
  **EVIDENCE**:
  ```
  data: {"type":"dock","state":"thinking"}
  data: {"type":"agent.status","status":"google/gemini-2.5-flash-lite · thinking…"}
  data: {"type":"dock","state":"idle"}
  data: {"type":"agent.status","status":""}
  ```
  Nothing in between. The chat row stayed empty and the embedded room
  did not swap to `workflow` (it stayed on `graph` from Q2).

- **WHAT**: LLM hallucinates tool syntax as plain text reply.  
  **WHERE**: orchestrator system prompt in
  `web/lib/agent/orchestrator.ts:21-55`. The `runOrchestrator` step cap
  is `stepCountIs(1)` so the LLM has one chance to emit text + structured
  tool calls; when it picks "describe what I would do" instead of "do it",
  the chat shows the description.  
  **EVIDENCE**: For Q5 ("i'm anxious about friday") the SSE stream
  contains literally
  `reply.chunk: text="open_window(kind='brief')\ndelegate_content(intent='i am anxious about friday')"`.
  Screenshot `04-5-q-i'm_anxious_abou-panel.png` shows that string sitting
  in the chat panel. The "ALWAYS-STAGE" rule the test scenario refers to
  did not fire — no canvas action was actually staged, no brief window
  opened, no delegate fired.

- **WHAT**: Race between `ui.room` (sets chatRoom) and `ui.tool` (dispatches
  to the room's registered tools) — tool dispatch fires before the room
  has registered its tools.  
  **WHERE**: `web/lib/agent-client.ts:58-66` handles `ui.room` then the
  next event arrives synchronously; `web/lib/room-tools.ts` (registerTools
  is keyed off the room mounting via React `useEffect`).  
  **EVIDENCE**: `console-errors.json` line 4 — warning
  `[room-tools] no tool 'search' on room 'graph'` even though
  `GraphRoom.tsx:382` does register `search`. The warning fires within
  ms of the room being switched.

- **WHAT**: Backend KG endpoint returns 422 four times.  
  **WHERE**: `https://app-bf31.onrender.com/api/kg/entities` GETs from
  GraphRoom mount in chat mode + Q2 (`graph_search`).  
  **EVIDENCE**: `network-failures.json` — 4 entries, 422 status. Not a
  chat-mode-specific bug but it surfaces here because graph is the room
  the orchestrator opens for "show me what's broken".

- **WHAT**: `recentActions` ring buffer (capped at 6 in
  `web/lib/store.ts:480-486`) loses tool calls during a 5-query session.  
  **WHERE**: `pushAction(record, cap=6)`. Every `agent.tool.start` event
  pushes one entry; combined with the orchestrator's own internal records
  (`open_window`, `delegate_content`, `graph_search`, etc.), 6 fills up
  inside two queries. The SnapshotInspector and any UI affordance reading
  from this buffer can't show a session-length history.  
  **EVIDENCE**: per-query log `toolCallsRecent` for Q3-Q5 reads `[]`
  even though the curl probes confirm Q4 produced `delegate_content` +
  `compare`. The newer actions pushed older ones out, but the slice math
  in our test misses them; structurally the buffer is too small to back
  any kind of inline tool-trace UI.

- **WHAT**: No way to interrupt or queue while the agent is in flight.  
  **WHERE**: `web/components/chat/ChatPanel.tsx:475` —
  `<textarea disabled={busy}>`.  
  **EVIDENCE**: `test-data.json` `sendDisabledMidFlight: { sendDisabled:
  true, textareaDisabled: true }`, `typedDuringBusy: false`. Defensive
  behaviour, but it means the user can neither pre-type nor cancel while
  the agent thinks; ChatGPT-style chats let you keep typing and surface a
  stop button.

- **WHAT**: Tool invocations are not rendered inline in the message list.  
  **WHERE**: `web/components/chat/ChatPanel.tsx:296-345` (Message
  component) only renders `{message.text}`. There is no surface that
  consumes `agent.tool.start` / `agent.tool.done` / `ui.room` events
  back into chat-message form; those events are mirrored only into the
  `recentActions` ring buffer that the SnapshotInspector reads.  
  **EVIDENCE**: Compare `04-2-q-show_me_what's_b-panel.png` vs the curl
  probe for the same query — the panel shows just the user message and a
  blank row; the SSE stream emitted `agent.delegate`, `agent.tool.start`,
  `ui.room`, `ui.tool`, `agent.tool.done`. None made it visible in chat.

## Subjective findings

- **The chat panel does not feel like a chat — it feels like a command
  surface that occasionally also speaks.** The defining property of a
  chat is "every turn produces a visible reply". This UI's chat mode
  doesn't guarantee that. WHY: because the orchestrator is optimised for
  windowed mode where the canvas IS the answer; in chat mode you need a
  belt-and-braces "always reply" rule (or a per-turn synthetic narration:
  "opened the brief", "ran graph_search broken").

- **The empty agent slot after a query is destabilising.** WHY: it's not
  even an empty bubble — there's nothing. The user can't tell whether the
  agent silently succeeded, failed, or didn't fire. The blinking caret in
  the input clears once busy goes false, so the only signal is "the right
  pane swapped". For Q3 (no swap, no reply) the system gives literally
  zero chat-side feedback.

- **Single-sentence replies (Q1) read fine on their own but feel
  abrupt.** WHY: with no avatar, no thread structure, just `you / agent`
  monospaced labels, "good morning to you too!" lands well as a one-off
  greeting but starts to feel terse when the tool-driven queries follow
  with nothing at all. The contrast — one reply that's a sentence, four
  replies that are silence — makes the agent feel inconsistent rather
  than economical.

- **Tool calls happening invisibly is the biggest UX gap.** WHY: when the
  right pane swaps to graph and a node lights up, the chat panel says
  nothing. A user can't reconstruct "what just happened" by scrolling
  back through chat history. There's no equivalent of the harness's
  inline tool-invocation card showing `🔧 graph_search (call) {query: "broken"}`.
  Without that, chat mode is harder to debug than windowed mode (where at
  least you see windows opening and rearranging).

- **The "WINDOWED" pill is well-placed (top-right of chat header) but the
  `MessageSquare` dock button to enter chat is far less obvious.** WHY:
  it's a small icon at the right end of the dock with a tooltip — once
  you're in chat mode, getting back to windowed is one obvious click; in
  windowed mode, knowing chat exists at all requires hovering. First-time
  discovery friction.

- **The `chat · showing brief` / room-tabs strip in the header doubles as
  the only way to switch rooms manually.** WHY: this is fine, but it
  visually conflicts with the agent's auto-swap behaviour. If the agent
  swaps me from `brief` to `graph`, the active tab changes silently; I'd
  expect a small inline event log "agent switched to graph" rather than
  the tab just relabelling.

- **The empty-state suggestion list is good** ("morning brief", "show me
  the graph", etc.). WHY: it teaches the chat lexicon without prescription.
  Once you've sent one query though it's gone forever, and there's no
  equivalent slash-menu accessible during an active conversation.

## Comparison to harness chat UI

The harness at
`agent/.worktrees/jordan-microbot_harness_v0/agent/harness/frontend/app/page.tsx`
is built on `@ai-sdk/react`'s `useChat` hook, which gives it a fundamentally
different message envelope: each message is `{ role, parts: [{type, ...}] }`
where parts can be `text`, `tool-invocation`, `tool-result`, etc. The
harness iterates parts and renders each kind explicitly. Concrete differences:

- **Tool invocations rendered inline as cards** (lines 47–93): every
  `tool-invocation` part becomes a blue panel showing `🔧 toolName (state)`
  with collapsible `args` and `result` `<details>` blocks. Desmond's chat
  panel has no equivalent — tool calls are SSE events that mutate the
  store and the right pane, but the chat history shows only `text`.

- **`ask_user` is a first-class interactive element** (lines 50–60, 138–211).
  When the agent calls `ask_user`, the harness renders a yellow card with
  the question and either preset option buttons or a free-text reply form.
  The user's response is fed back via `addToolResult({ toolCallId, result })`
  to satisfy the pending tool call. Desmond's chat panel has no `ask_user`
  surface; the orchestrator can't pause for a structured user response —
  it only streams text + tool side-effects in one shot.

- **Message envelope shape**: harness keeps full `parts` history per
  message — text and tool calls in the order they happened, so a single
  agent turn might be `[text, tool-invocation, text]`. Desmond's
  `ChatMessage` (`web/lib/store.ts:190-199`) is `{ role, text, ts, room,
  status }` — text-only, with `room` as a tag. There's no place to put
  tool calls.

- **History shape**: harness uses a single linear `messages` array driven
  by the SDK; Desmond's chat keeps `chatMessages` in Zustand,
  `recentActions` in a separate 6-cap ring, and `agentReply` as scratch
  string for the dock-narration. Three parallel state shapes, none of
  which is canonical for "what happened in this turn".

- **Streaming feel**: harness shows the streaming token-by-token via the
  SDK's built-in handling — a genuine "ChatGPT typewriter" effect.
  Desmond's `appendToLastAgentMessage` does append chunks (so the
  typewriter cursor in `ChatPanel.tsx:336-341` works for queries that
  produce text), but tool-only turns have no streaming animation at all
  because `reply.start` was never emitted to seed the placeholder.

- **Loading state**: harness has a single `thinking…` line under the last
  message (line 100). Desmond has a `<Pending>` row with a breathing dot
  and `agentStatus` text — visually nicer, but it's only shown while
  `busy && last role !== agent`, so once `reply.start` lands (and seeds an
  empty agent message), the Pending disappears even if the reply is empty.
  For tool-only turns where `reply.start` never fires, you get a brief
  Pending then nothing.

- **Error surface**: harness has a dedicated red `chat-error` line for
  `error.message`. Desmond logs to `console.error` in `submit()` and
  silently swallows `AgentFallback` once the local router runs. No chat
  message ever surfaces an error to the user.

- **Visual density**: harness is utility-grade (system fonts, minimal
  colour, plain `<div>`s with inline styles). Desmond's chat panel is
  the polished MUJI / hand-drawn aesthetic — far better motion, type,
  rhythm. The polish is real; it just doesn't yet carry tool calls.

## Harness-merge implications

If the harness becomes a "code interpreter" room embedded in chat mode
(option 5b in `docs/triage-2026-04-26-ui-harness-sync.md`), the chat panel
needs the following concrete diffs to host it without losing the harness's
UX guarantees:

1. **Extend `ChatMessage` to a parts model.** Replace
   `{ role, text, ts, room, status }` with
   `{ role, parts: ChatPart[], ts, room, status }` where
   ```
   type ChatPart =
     | { kind: "text"; text: string }
     | { kind: "tool"; name: string; args: unknown; state: "call" | "result" | "error"; result?: unknown }
     | { kind: "ask_user"; toolCallId: string; question: string; options?: string[] }
     | { kind: "ui_action"; event: "ui.room" | "ui.tool" | "ui.arrange"; summary: string }
   ```
   The store actions `appendChatMessage`, `appendToLastAgentMessage`,
   `finalizeLastAgentMessage` all need a "which part am I appending to"
   selector. Touch points: `web/lib/store.ts:190-405`,
   `web/lib/agent-client.ts:121-170` (every event that should be visible
   in chat history needs a corresponding part-append).

2. **Render parts inline in `Message`** (`ChatPanel.tsx:296-345`). Each
   part needs its own visual treatment matching the harness conventions:
   text body for `text`, blue tool card for `tool` (with collapsible
   args/result), yellow ask card for `ask_user` (with form), small inline
   chip for `ui_action` ("opened brief", "ran graph_search broken").

3. **Wire `ask_user` back to the orchestrator.** The harness's
   `addToolResult({ toolCallId, result })` pattern requires a server-side
   pending-tool-call store. The current `/api/agent/orchestrate` is
   one-shot — it streams once and returns. Adding `ask_user` requires
   either (a) keeping the LLM step alive across an HTTP boundary
   (long-running with idle ping) or (b) packaging the chat into a
   per-thread session like the harness's `/api/chat` does via the SDK.
   Touch points: `web/app/api/agent/orchestrate/route.ts` would likely
   become a wrapper around `streamText` from `ai` SDK with `maxSteps > 1`
   (matching harness's `maxSteps: 8`), and message-history would need to
   be sent on each request.

4. **Synthesise narration for tool-only turns.** Even with parts wiring,
   the orchestrator needs to either (a) be prompted hard to always emit
   one reply chunk (current prompt asks but Gemini Flash-Lite ignores it)
   or (b) the route handler should auto-synthesise a fallback summary
   like "opened brief" if no reply text arrives. Touch points:
   `web/app/api/agent/orchestrate/route.ts:94-103` — wrap the textStream
   loop so that on `reply.done` if no chunks were emitted, the route
   inserts a `reply.chunk` with a generated summary based on the tool
   calls that fired.

5. **Reconcile the LLM split.** Harness uses Anthropic Sonnet for code
   tool-use; chat-mode UI uses Gemini Flash-Lite for layout. Folding the
   harness in means either (a) a "Code Interpreter" room mounts under the
   harness's `/api/chat` (different model), and the chat panel switches
   transports based on the focused room, or (b) the orchestrator gains a
   `delegate_code(...)` tool that returns the harness sub-agent's output
   inline. Option (a) requires the chat panel to know which transport to
   call per turn (read from `chatRoom`); option (b) keeps a single transport
   but adds latency from sub-agent hops.

6. **Tool-call visibility for the existing windowed agent.** Even
   independent of harness merge, the orchestrator already has a `delegate_content`
   sub-agent and per-room tools (`graph_search`, `compare`, etc.) that
   are invisible in chat mode today. Extending the parts model fixes both
   the harness merge AND the chat-mode legibility gap with one change.

7. **Replace `recentActions` cap-of-6 with a session-scoped log.** If
   tool parts go inline in the chat history, the ring buffer becomes
   redundant; keep one canonical source of truth (the chat history) and
   let SnapshotInspector read from it instead. Touch points:
   `web/lib/store.ts:262-265, 480-486`.

## Per-query log

| query | reply text (or summary) | tool calls visible | room swapped to | felt right? |
|---|---|---|---|---|
| `good morning` | "good morning to you too!" | None (no tools fired per curl probe) | brief (default, no swap) | y — clean greeting reply, only query that felt like a real chat turn |
| `show me what's broken` | *(empty)* — no reply.chunk emitted | None visible in chat. Server actually fired `agent.delegate(content)` + `graph_search(query="broken")` per curl probe. | graph (correct) | n — agent went silent in chat; user only sees the right pane swap to graph; no narration of *why*. Plus a `[room-tools] no tool 'search' on room 'graph'` warning fires due to the ui.room→ui.tool race |
| `open the workflow for triaging bugs` | *(empty)* — no events at all | None | did NOT swap (still on graph) | n — total dead air. The orchestrator emitted `dock:thinking` then `dock:idle` with nothing in between. User sees their own message and silence. Workflow window is never opened |
| `compare slack and gmail` | *(empty)* — no reply.chunk | None visible. Server fired `agent.delegate(content)` + `compare(a="slack", b="gmail")` (a `ui.verb` event), per curl probe. | did NOT swap (still on graph from Q2) | n — `compare` verb fires but verbs only mutate `lastVerb`; no UI change visible to the user. Chat is silent. Worst-feeling turn of the session |
| `i'm anxious about friday` | "open_window(kind='brief')\ndelegate_content(intent='i am anxious about friday')" | None — model wrote tool syntax as plain text instead of calling the tools | did NOT swap (still on graph) | n — model failure: the LLM described what it would do instead of doing it. The "ALWAYS-STAGE" marginal-intent rule did not fire. Brief window was not opened, content sub-agent was not delegated |

**Summary of per-query outcomes**: 1/5 felt like a real chat exchange.
Two queries (Q3, Q5) are model failures (Gemini Flash-Lite either emits
nothing or emits tool-syntax-as-text). Two queries (Q2, Q4) executed
successfully on the server but produced no visible chat history — a
chat-mode UX gap, not a model gap. The mode-toggle round trip (chat →
windowed inheriting graph as a window → opening brief in windowed →
toggling back to chat with brief now embedded) worked perfectly:
`focusedRoomBefore: "graph"`, `windowsAfterToggle.windows[0].kind: "graph"`,
then after opening brief and toggling, `briefIsEmbedded.chatRoom: "brief"`.
Edge cases also held up: empty submit no-ops, mid-flight submit is
defensively blocked (textarea + send button both disabled).
