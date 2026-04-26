# B + C — findings, independently verified against source

Companion to `D-findings-verified.md`. Each numbered claim from B (chat
mode) and C (coding-agent fit) is checked against the actual source on
`origin/main`. Same status legend. **DUPLICATE** marks a finding that
restates one already verified in D.

---

## From B (chat mode)

### B1 — Chat-mode "silent agent": tools-only turns leave the agent message slot empty

**Status: VALIDATED. This is the most consequential bug surfaced today.**

The `reply.start` event is the *only* path that pushes a fresh `agent`
message into `chatMessages`. Two-file confirmation:

`web/app/api/agent/orchestrate/route.ts:94-103`:
```ts
let started = false;
for await (const chunk of result.textStream) {
  if (!started) {
    emit({ type: "reply.start", query });
    emit({ type: "dock", state: "speaking" });
    started = true;
  }
  if (chunk.length > 0) emit({ type: "reply.chunk", text: chunk });
}
if (started) emit({ type: "reply.done" });
```

`reply.start` is gated on the FIRST text chunk arriving from
`result.textStream`. If the LLM emits zero text (a tools-only turn),
`started` stays false and `reply.start` is never sent.

`web/lib/agent-client.ts:121-136`:
```ts
case "reply.start":
  s.startReply(evt.query);
  // In chat mode, push a fresh agent message placeholder.
  if (chat) {
    s.appendChatMessage({
      id: `agent-${Date.now()}`,
      role: "agent",
      text: "",
      ts: Date.now(),
      room: s.chatRoom,
      status: "streaming",
    });
  }
  break;
```

This is the only `appendChatMessage` for `role: "agent"` in the file.
No `reply.start` ⇒ no agent slot in the history.

The other event handlers either mirror to other state shapes
(`agent.tool.start` → `recentActions` ring at lines 154-160) or mutate
non-history state (`ui.room` in chat mode → `setChatRoom` at line 61
without touching history; `ui.tool` → `callRoomTool` fire-and-forget at
line 95 without touching history).

B's per-query data confirms the pattern in `test-data.json`:

| query | replyLength | toolCallsRecent | history-side outcome |
|---|---|---|---|
| good morning | 24 | `[]` | agent reply rendered ✓ |
| show me what's broken | 0 | `[delegate_content, graph_search]` | empty agent slot, room swapped silently |
| open the workflow for triaging bugs | 0 | `[]` | dead air — no tools, no text, no swap |
| compare slack and gmail | 0 | `[]` (cap eviction, see B5) | empty slot |
| i'm anxious about friday | 25 | `[]` | text was leaked tool-call syntax (see B3) |

So 1/5 turns produced a real chat reply. The visible chat panel matches
that count, not the actual server-side activity.

### B2 — One query produced ZERO server-side events (orchestrator silent failure)

**Status: VALIDATED on the symptom; root cause is model-side.**

For the query "open the workflow for triaging bugs" the orchestrator
emitted `dock:thinking → dock:idle` with no tool calls and no text in
between. `test-data.json` shows `toolCallsRecent: []` and
`embeddedRoomKind: "embedded-room-graph"` (still on the prior room).

Code-side this is reachable when `runOrchestrator`'s `streamText` returns
a stream that yields no tool calls and no text — i.e. the LLM produced
nothing. `orchestrate/route.ts` doesn't have a synthetic-fallback for
zero-output streams (no "I didn't understand" toast, no retry). The
control flow goes straight to `finally { dock:idle, agent.status:"" }`.

Worth noting: the orchestrator system prompt forbids opening
`workflow` in windowed mode but the snapshot was `chat`. Per
`orchestrator.ts:25`, chat mode does include `workflow`. So this isn't
a guardrail rejection — it's the model giving up. Probably a
Flash-Lite quirk on this specific phrasing; would benefit from a
"never produce zero output, always at minimum push a confirm/error
toast" rule in the route handler.

### B3 — LLM hallucinates tool-call syntax as plain text

**Status: VALIDATED. DUPLICATE of D's F6 — second independent reproduction.**

B's Q5 ("i'm anxious about friday") produced a `reply.chunk` containing
the literal string `"open_window(kind='brief')"`. This is the same
class of failure D captured for "show me the graph" with output
`"degraded · open_window(kind=\"graph\")"`. Two independent contexts,
same defect.

Belongs in the agent-evals reliability sprint with a system-prompt nudge:
"Never include tool-call syntax in reply text. Reply text is plain prose
or empty."

### B4 — `compare` verb fires but is invisible to the user

**Status: VALIDATED.**

`web/lib/agent-client.ts:98-100`:
```ts
case "ui.verb":
  s.emitVerb({ verb: evt.verb, args: evt.args, at: Date.now() });
  break;
```

`emitVerb` only writes to `lastVerb` in the store. There's no
component subscribing to `lastVerb` that renders into chat or onto
the canvas (verified by grepping `useAgentStore.*lastVerb` — no
read-side consumers in `components/`). So when the orchestrator
delegates `compare(a="slack", b="gmail")`, the verb is recorded for
SnapshotInspector and nothing else changes for the user.

This is a registered tool with no UI affordance. Either the rendering
needs to be added (a "compare" card kind, or inline message annotation)
or the tool should be retired from the agent's surface until it has a
view.

### B5 — `recentActions` ring buffer is hard-coded to 6 entries

**Status: VALIDATED.**

`web/lib/store.ts:480-486`:
```ts
pushAction: (record, cap = 6) =>
  set((s) => {
    const next = [...s.recentActions, record];
    const trimmed = next.length > cap ? next.slice(next.length - cap) : next;
    return { recentActions: trimmed };
  }),
```

Plus three direct in-place pushes that hard-slice to `-6`:
- `:573-576` (openWindow → push `open_window` action)
- `:589-599` (closeWindow → push `close_window` action)
- `:675-678` (arrangeWindows → push `arrange_windows` action)

The cap is enforced redundantly, both in the helper and in the
direct mutators. With Q1 firing `open_window` + agent emits
`agent.delegate`, `agent.tool.start` for each delegated call, the ring
fills inside the first turn. By Q3 of B's run, the inspector sees an
empty ring even though the server fired tools — they were already
evicted.

Not a chat-mode-specific bug, but it cripples any UI plan that wants
a session-scoped tool log (which the merge with the harness would
benefit from — see implications at the bottom).

### B6 — Race between `ui.room` and `ui.tool` in the same orchestrator turn

**Status: VALIDATED. DUPLICATE of D's NEW1.**

B's `console-errors.json` line 4: `[room-tools] no tool 'search' on
room 'graph'`. Same root cause established in `D-findings-verified.md
§ NEW1`: the orchestrator emits `ui.room` then `ui.tool` in the same
turn; the room registers tools in a `useEffect` that hasn't run when
the tool dispatch arrives.

Not a separate finding. Folds into the same fix.

### B7 — Tool calls have no inline rendering in the chat panel

**Status: VALIDATED.**

`web/components/chat/ChatPanel.tsx` Message component (per B's report
at `:296-345`) renders only `{message.text}`. `agent.tool.start`,
`agent.tool.done`, `agent.delegate` and `ui.room` events have no
chat-history side effect. This is the structural reason chat mode
feels like a "one-way speaker tube": tool side-effects mutate the
canvas and the recentActions ring, but never the visible message log.

The harness's chat at
`agent/.worktrees/jordan-microbot_harness_v0/agent/harness/frontend/app/page.tsx`
demonstrates the converse pattern: each `tool-invocation` part renders
inline, with collapsible args/result. The merge will need this pattern
back-ported.

---

## From C (coding-agent fit)

### C1 — `open_window(kind="brief")` succeeds in windowed mode despite the system-prompt prohibition

**Status: VALIDATED. This is a real client-side gate gap.**

`web/lib/agent-client.ts:58-67`:
```ts
case "ui.room":
  if (chat) {
    s.setChatRoom(evt.room);
  } else {
    s.openWindow(evt.room, { rect: evt.rect, payload: evt.payload });
  }
  if (evt.slug) s.setRoomSlug(evt.slug);
  ...
```

There is **no client-side gate** on `kind` per `uiMode`. The check
`if (chat)` only routes the event; it doesn't validate that the
requested kind is allowed for the current mode.

The orchestrator's system prompt at `orchestrator.ts:23-25,49`:
```
WINDOWED mode (check <canvas mode=>): only three kinds exist:
  settings, integration (slug=...), graph.
…
in WINDOWED mode NEVER open brief / workflow / stack / waffle / playbooks — refused.
```

…is a soft rule the LLM is supposed to honour. C's run produced an
`open_window(kind="brief")` event in windowed mode and the client
opened it. There is also a smoke test
(`web/tests/windowed-mode-tools-smoke.mjs`) that asserts this *should*
fail; it presumably tests the orchestrator's behaviour, not a
client-side gate.

Two ways to close this:
1. **Client gate**: in `agent-client.ts:58-67`, refuse `open_window`
   for any kind not in the windowed-mode allow-list (`settings`,
   `integration`, `graph`). Emit a toast on the rejection so the agent
   can re-plan.
2. **Server gate**: have the orchestrator's tool implementation
   (`layoutTools` in `lib/agent/tools.ts`) refuse the call before the
   `ui.room` event is emitted at all.

Option 2 is harness-aligned (the rule lives next to the tool
definition, not scattered across the client switch).

### C2 — `integration_connect(slug=slack)` triggers `[room-tools] no tool 'connect'`

**Status: VALIDATED. DUPLICATE of D's NEW1.**

Same race as B6 / D-NEW1. The `integration_connect` content-agent tool
(at `content-agent.ts`) calls `ui.tool` with `tool: "connect"` for the
integration room. The room registers `connect` (verified at
`IntegrationRoom.tsx:347`) but the agent fires before mount. Same
queue/pre-register fix.

### C3 — The `draft` tool produces a `kind:"diff"` card with no code body

**Status: VALIDATED.**

`content-agent.ts:52`: `draft(topic) — surface a generated draft as a
diff card`. Content-agent's `push_card` accepts kinds `memory`,
`entity`, `source`, `diff`, `toast` (per `agent-client.ts:18-22`'s
type union). The `diff` card kind has `data: Record<string, unknown>`
in the store — there's no schema enforcement that says "diff must
include code/before/after". Content-agent is happy to write a label
("Draft ready · python script…") and a confidence number, with no body.

`web/components/cards/CardStack.tsx` (the renderer) uses a generic
`CardBody` that displays whatever's in `data.text` plus a confidence
chip if present. There's no special-case rendering for `diff` that
expects code or a side-by-side view.

So the `draft` tool is currently a **label generator masquerading as a
draft surface**. To make it useful, either (a) it needs to actually
emit code in the card data and the card renderer needs to display it,
or (b) the content-agent prompt needs the tool removed until it does.
This is the most consequential symptom of "no code-execution affordance
in the UI" — the agent thinks it's drafting; the user sees a label.

### C4 — `ask_user` has zero infrastructure in the UI today

**Status: VALIDATED.**

`web/lib/store.ts` defines `CardKind = "memory" | "entity" | "source"
| "diff" | "toast"`. No `prompt` / `ask` / `confirm` kind. No modal
primitive in `web/components/`. No client-side handler in
`agent-client.ts` for a `ui.prompt` event (no such event in the
`AgentEvent` union at `:8-52`).

For comparison, the harness's `ask_user` is a first-class
`AskUserPrompt` component at
`agent/.worktrees/jordan-microbot_harness_v0/agent/harness/frontend/app/page.tsx:138-211`,
client-resolved via `addToolResult({ toolCallId, result })`.

This is a hard prerequisite for any destructive-action gate in the UI
(C's Q5 — "post slack 'hello team'" — went straight to OAuth without
asking the user; the orchestrator currently *cannot* ask, even if it
wanted to).

### C5 — Composio OAuth flow lost the original message text in C's Q5

**Status: VALIDATED.**

C's Q5 was "post a slack message to #general saying 'hello team'".
The agent's response (per C's per-query log) was
`delegate_content → integration_connect(slug=slack) → open_window(integration)`.
Notably absent: any record of `"hello team"` or `"#general"` in the
tool args or in any persisted store state.

`content-agent.ts`'s `integration_connect` tool only takes a `slug`
parameter (per the system prompt at line 53). The user's intent ("send
this message to that channel") gets compressed into "the user wants
the slack integration" and the message text is dropped on the floor.

This is a content-agent prompt + tool-schema gap, not a runtime bug.
The closest fix is either (a) accept a `pending_action` payload on
`integration_connect` and replay it on connection success, or (b)
push a `kind:"source"` card capturing the user's verbatim request so
they can re-trigger after connecting.

---

## Summary table

| ID | Source | Status | One-line takeaway |
|---|---|---|---|
| B1 | B | **VALIDATED — most consequential** | Tools-only turns leave empty agent message slots in chat history. |
| B2 | B | VALIDATED | One query produced zero server output (model gave up). No fallback. |
| B3 | B | VALIDATED — DUPLICATE of D-F6 | LLM leaks tool-call syntax as text — second independent reproduction. |
| B4 | B | VALIDATED | `compare` verb mutates `lastVerb` only; no UI affordance reads it. |
| B5 | B | VALIDATED | `recentActions` ring buffer hard-capped at 6 — too small for a session log. |
| B6 | B | VALIDATED — DUPLICATE of D-NEW1 | `ui.room` → `ui.tool` race fires `[room-tools] no tool 'search'` warnings. |
| B7 | B | VALIDATED | Chat panel renders only `text`; tool calls / room swaps invisible in history. |
| C1 | C | VALIDATED | `open_window(brief)` is not client-gated by mode — system-prompt rule alone. |
| C2 | C | VALIDATED — DUPLICATE of D-NEW1 | `integration_connect` triggers the same room-tool race. |
| C3 | C | VALIDATED | `draft` tool emits a label + confidence; no code body anywhere. |
| C4 | C | VALIDATED | No `prompt` card kind, no modal primitive — `ask_user` cannot be hosted. |
| C5 | C | VALIDATED | OAuth flow drops the user's verbatim "send this message" intent. |

## Cross-cutting clusters (de-duplicated)

When you collapse the duplicates, the verified objective bugs cluster
into six themes:

1. **Chat-mode tool-only turns are silent in history** (B1, B7). Two
   sub-fixes: emit `reply.start` unconditionally OR mirror tool events
   into `chatMessages`. The harness pattern is the latter.
2. **Orchestrator can leak tool-call syntax as text** (B3 = D-F6).
   System-prompt nudge + an output-side scrub.
3. **Race between `ui.room` and `ui.tool`** (B6 = C2 = D-NEW1). Queue
   tool calls per room, or pre-register tools at the store layer.
4. **No client-side guard on illegal-mode `open_window`** (C1). Either
   the client switch enforces, or `layoutTools` refuses.
5. **Content sub-agent has tools without backing UI** (B4 `compare`,
   C3 `draft`). Either build the affordance or retire the tool from
   the surface.
6. **Backend-down failure surface bleeds into "looks empty"** (D-F1a,
   D-F2, D-F4, D-F5, D-F7). Already covered in D.

## Implications for the merge

These three are the ones that bias decisions on the merge directly:

- **B7 (no tool rendering in chat)** is the single largest gap between
  Desmond's chat panel and the harness's chat. If the harness folds in
  as a code-interpreter room (option 5b in `docs/triage-2026-04-26-ui-harness-sync.md`),
  the chat panel needs the parts model B's report describes (text +
  tool-invocation + ask_user + ui_action). Without this, the harness's
  `run_code` etc. would fire but be invisible — same failure mode as
  Desmond's `compare` today.
- **C4 (no `ask_user` infrastructure)** is a hard prerequisite for any
  harness-shaped destructive-action gate. Lift the `AskUserPrompt`
  component from the harness into a `prompt` card kind plus an
  inline-rendered chat part.
- **B1 (silent agent on tool-only turns)** is the same root issue from
  a different angle: the SSE protocol assumes "reply text is the
  primary signal" but the harness's protocol uses "tool calls are
  first-class observable events". Reconciling these is part of why
  harness-aligned chat history is the right merge bias from
  `merge-principles`.
