# A — findings, independently verified against source

Companion to `D-findings-verified.md` and `BC-findings-verified.md`.

## A1 — Stale `agentReply` lingers in the dock on tools-only turns

**Status: VALIDATED. Same root cause as B1, different surface (windowed mode).**

`web/lib/store.ts:810` is the only code path that clears `agentReply`:
```ts
startReply: (query) => set({ agentReply: "", lastQuery: query }),
```

`web/lib/agent-client.ts:121` calls `startReply()` only on `reply.start`.

`web/app/api/agent/orchestrate/route.ts:94-103` only emits `reply.start`
when the FIRST `textStream` chunk arrives. Tools-only turns produce no
chunks, so the event is never sent and `agentReply` never resets.

The dock narration (`FloatingDock`) and the tucked-state chip
(`CommandBar`) both subscribe to `agentReply`. Result: when a tool-only
turn fires, the dock keeps showing the previous turn's reply text.

A's q04/q05 are textbook reproductions: the dock shows "i can't open
workflows in windowed mode" (from q03) while q05 fires six
`open_window(integration)` calls. Visibly inconsistent UI.

## A2 — Agent self-contradicts on q05

**Status: VALIDATED — direct consequence of A1.**

Not a separate bug — the same `agentReply` not-resetting issue causes
the dock to display q03's apology while q05's tools execute. Mark as
A1's most damaging visible symptom rather than a distinct defect. Fix
A1 and A2 disappears.

## A3 — Six integration windows open at the exact same rect (no fan-out)

**Status: VALIDATED.**

`web/lib/store.ts:489-579` (`openWindow`) has two rect-resolution paths:

- Lines 519-522 (no `defaultMount`, or explicit rect supplied): jitters
  the centre by `(s.windows.length % 5) * 32` px on x and `% 5 * 24`
  on y. Stagger.
- Lines 523-549 (`defaultMount` resolves to pct): computes the rect
  from `resolveMount(defaultMount, viewport)`, applies inset/outer
  trim. **No jitter, no orbit-the-focus offset, no "Nth window goes
  here" logic.**

When the orchestrator fires `open_window(kind="integration", mount="full")`
six times, each call follows the second path and resolves to the same
rect. Verified in `run.log`: every integration window ends up at
`{x:738, y:21, w:666, h:778}`.

The eval harness's principle "demoted windows orbit the focus" lives
only in the layout-agent's old prompt; the layout-agent was retired
in the orchestrator-direct refactor (per `orchestrator.ts:1-12`
header comment), and the principle didn't migrate into `openWindow`.

## A4 — Slug-less `open_window(integration)` calls don't dedupe

**Status: VALIDATED — bug is in event payload shape, not the dedupe logic.**

The dedupe logic at `store.ts:498-504` checks `w.payload?.slug ===
wantedSlug` where `wantedSlug = opts?.payload?.slug`. So two slug-less
calls (both `wantedSlug = undefined`) should dedupe to one window.

A's `query-log.json` for q05 shows the agent emitted three slug-less
`open_window(integration)` calls and three slug-ful (`linear`,
`notion`, `perplexityai`). Six windows resulted.

Evidence the slug-ful calls also failed to dedupe: even slug-distinct
calls won't dedupe across each other (linear vs notion are different
slugs, fine — that's expected). What shouldn't happen: the three
slug-less calls each open a new window.

A's hypothesis is correct: the orchestrator is passing `slug` at the
top level of the `ui.room` event (`evt.slug`) rather than nesting it in
`payload`. `agent-client.ts:63` passes `payload: evt.payload` to
`openWindow` — if the orchestrator's `open_window` tool puts the slug
into `evt.payload.slug`, dedupe works; if it puts it at `evt.slug`
(top-level), dedupe sees `payload?.slug = undefined` for everything
and never matches.

`agent-client.ts:65` reads `evt.slug` separately to call `setRoomSlug`,
so the orchestrator IS emitting slug at top level. Either:
- Move slug into payload at the orchestrator-tool level (preferred —
  matches the dedupe contract), OR
- Update the dedupe in `openWindow` to accept slug from a top-level
  field that `agent-client` passes through.

## A5 — `q01 morning brief` rejection has no fallback affordance

**Status: VALIDATED, partial subjective.**

Refusal is correct — `brief` isn't in the windowed-mode allow-set per
`orchestrator.ts:23-25`. The orchestrator system prompt at line 49
explicitly forbids it.

What's missing is a graceful next-step. The reply is a bare toast,
"briefs are not available in windowed mode." No card with the proposal
summary, no clickable link to flip to chat mode, no
`open_window(settings)` to expose the mode toggle. From the user's
perspective the agent acknowledges they want a brief and just refuses
without explaining what to do.

This is a system-prompt opportunity, not a code bug. Mark partial
subjective.

## A6 — Zero `ui.card` events emitted across the entire 5-query run

**Status: VALIDATED.**

A's `query-log.json` `newCards` is `[]` for all five queries. The only
card during the session was the `settings_user_id_save` toast.

Cause: the `delegate_content` tool was only invoked once (q05), and
even then the content sub-agent didn't push any `memory`/`entity`/
`source`/`diff` cards. The orchestrator's heuristics at
`orchestrator.ts:42-47` ("anxiety→brief/stack, curiosity→graph,
recap→brief, risk→stack+brief (chat mode only)") nudge it to
*open windows* before delegating content; for windowed-mode queries
where rooms are restricted to graph/settings/integration, the agent
mostly refuses or opens the wrong room and never gets to the content
delegation step.

Result: in windowed mode, the entire content-card vocabulary
(`memory`, `entity`, `source`, `diff`) is effectively dead. Cards
appear only when chat mode (where brief/workflow/stack are reachable)
or when the user goes through the integration OAuth flow.

This is more product-shape than bug. Worth surfacing because it
suggests the windowed-mode orchestrator should either (a) loosen the
"never push cards in windowed" implicit policy, or (b) widen the
allowed kinds, or (c) accept that windowed mode is canvas-shaped and
chat mode is content-shaped, which is a real product call.

## A7 — `[room-tools] no tool 'clear' on room 'graph'`

**Status: DUPLICATE of D-NEW1 / B6 / C2.**

Same race condition. Tool IS registered (`GraphRoom.tsx:390` registers
`clear`), the agent just calls it before the room mounts.

A's hypothesis ("a `clear` tool that was never registered") is
incorrect; the verification in `D-findings-verified.md § NEW1`
establishes the registration race as the actual cause.

## A8 — `/api/kg/entities` returns 422

**Status: VALIDATED via network-failures.json; root cause is backend-side, out of scope for this verification.**

A's `console-errors.json` shows two GETs to
`https://app-bf31.onrender.com/api/kg/entities` returning 422.

422 (unprocessable entity) means the request shape is wrong — likely a
missing or malformed query parameter. Not a backend-down failure (which
would be 503 / connection refused per D's testing).

The frontend at `web/lib/api/backend.ts:321-327` calls
`getKgEntities(entityType?, userId?)`. With `entityType` undefined it
sends no `?entity_type=` param. If the backend route requires the
parameter, that's a frontend-backend contract mismatch.

To verify root cause, would need to read `app/routes/api_kg.py` (out of
scope here — the parallel-test session deliberately had `app/main.py`
unreachable for D, but this 422 came back from the configured Render
host, not localhost). Mark VALIDATED at the frontend level + needs
backend-side investigation.

---

## Summary table

| ID | Status | Takeaway |
|---|---|---|
| A1 | **VALIDATED** | Tools-only turns leave stale `agentReply` in dock — same root as B1, different surface. |
| A2 | VALIDATED — symptom of A1 | Self-contradicting dock text vs canvas activity. |
| A3 | **VALIDATED** | `defaultMount`-resolved windows have no jitter/fan-out — N integrations at same rect. |
| A4 | **VALIDATED** | Slug at top-level of `ui.room` event vs `payload.slug` in dedupe → slug-less calls multiply. |
| A5 | VALIDATED partial | `brief` refusal in windowed mode lacks a "switch to chat" affordance. |
| A6 | VALIDATED | Zero content-cards in 5-query windowed run. Product-shape question. |
| A7 | DUPLICATE of D-NEW1 | Same room-tool race, mislabelled as "no impl". |
| A8 | VALIDATED at FE level | `/api/kg/entities` 422 — needs backend route check. |
