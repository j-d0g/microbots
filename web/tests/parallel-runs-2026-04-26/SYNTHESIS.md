# Synthesis — UI parallel test run, 2026-04-26

Four ephemeral subagents drove the UI end-to-end against the dev server
at http://localhost:3001 (running `origin/main` HEAD `1d152ef`). All
findings cross-checked against the source. This doc is the master
trail: per-subagent reports + verifications cited inline.

- A — onboarding + windowed mode → `A-onboarding-windowed/report.md` · `A-findings-verified.md`
- B — chat mode + mode toggle → `B-chat-mode/report.md` · `BC-findings-verified.md`
- C — coding-agent fit → `C-coding-agent-fit/report.md` · `BC-findings-verified.md`
- D — backend-down failure surface → `D-backend-failure-surface/report.md` · `D-findings-verified.md`

---

## TL;DR

When you collapse duplicates, today's UI has **eight verified
objective bugs**, ranked by impact. Three of them are root causes that
explain six other surface symptoms — fix those three and most of what
the subagents saw goes away. The remaining subjective findings are
parked at the bottom for you to reproduce and triage.

---

## Objective bugs — ranked, deduplicated

Each row: ID · status · severity (1=must-fix, 5=nice) · cross-refs to
which subagent surfaced it · pointer to where the fix goes.

### O1. Tools-only turns leave the agent silent (chat) and the dock stale (windowed) {#o1}
**Severity 1.** **Root cause for B1, A1, A2, B7 in part.**
Surfaced by: A, B. Verified: BC §B1, A §A1, A §A2.

`reply.start` only fires when the LLM produces text
(`orchestrate/route.ts:94-103`). `startReply()` is the only thing that
clears `agentReply` (`store.ts:810`) and the only event that pushes a
fresh agent message into chat history (`agent-client.ts:121-136`).

Two fixes, complementary not alternative:

1. **Always emit `reply.start`** in the orchestrate route, regardless
   of whether text follows. `web/app/api/agent/orchestrate/route.ts:94-103`.
2. **Mirror tool events into chat history** in chat mode. Extend the
   `ChatMessage` shape to include `tool` parts (B's report at
   "Comparison to harness chat UI" has the exact diff).

(2) is the harness-aligned shape — see merge implications below.

### O2. Orchestrator can leak tool-call syntax as plain text {#o2}
**Severity 1.** Surfaced independently by A, B, D — three reproductions.
Verified: D §F6, BC §B3, A §A4 (drive-by).

The model emits strings like `open_window(kind="graph")` or
`degraded · open_window(kind=\"graph\")` as `reply.chunk` text instead
of as a structured tool call. No window opens; user sees the syntax in
the dock or chat panel. Three independent test contexts produced this,
so it's not a one-off.

Fix is layered:
- Tighten the orchestrator system prompt at `orchestrator.ts:21-55`:
  add an explicit "NEVER write tool-call syntax in the reply text;
  reply text is plain prose or empty."
- Add an output-side scrub: regex out `^\w+\(.*\)$` patterns from
  `reply.chunk` events before emitting (defensive belt-and-braces).

This is also the shape we'll need to harden for any code-interpreter
agent we fold in.

### O3. Race between `ui.room` and `ui.tool` in the same orchestrator turn {#o3}
**Severity 2.** Surfaced by A, B, C, D. Verified: D §NEW1, BC §B6 §C2, A §A7.

When the orchestrator emits `ui.room` then `ui.tool` in the same turn
(common pattern: open + filter, open + select, open + highlight), the
tool dispatch fires before the new room's `useEffect` registers its
tools. `room-tools.ts:117-122` console.warns and silently drops the
call.

Three fixes (in order of preference):
1. **Queue tool calls per room** in `agent-client.ts:92-97` — buffer
   `ui.tool` events for a kind until that kind's tool registry has at
   least one entry, with a 500ms timeout fallback to "tool not
   available".
2. Pre-register tool stubs at the store layer, with deferred
   resolution against the eventual handler.
3. Emit `ui.tool` events one tick after `ui.room` so React has time
   to mount.

(1) is the most robust and matches the fire-and-forget contract
already in `applyAgentEvent`.

### O4. `defaultMount`-resolved windows have no jitter / orbit / fan-out {#o4}
**Severity 2.** Surfaced by A. Verified: A §A3.

`store.ts:519-522` (the no-mount path) jitters by
`(s.windows.length % 5) * 32` px. `store.ts:523-549` (the mount path)
doesn't. When the agent opens N integration windows with
`mount: "full"`, all N stack at the same rect.

Fix: apply the same `(windowsOfThisKind.length % 5) * 32` jitter in
the mount-path branch. Optional richer fix: implement "demoted windows
orbit the focus" per `web/agent-evals/AGENTS.md` layout principles.

### O5. Slug-less integration `open_window` calls don't dedupe {#o5}
**Severity 2.** Surfaced by A. Verified: A §A4.

`store.ts:498-504` dedupe checks `w.payload?.slug === wantedSlug`
where `wantedSlug = opts?.payload?.slug`. The orchestrator emits slug
at the top level of `ui.room` events (`evt.slug`, used at
`agent-client.ts:65`), not inside `payload`. So `payload?.slug` is
always undefined and dedupe never matches.

Fix: at the orchestrator tool boundary
(`web/lib/agent/tools.ts → open_window`), put `slug` into
`payload.slug` before emitting, OR pass slug through to `openWindow`'s
opts at `agent-client.ts:63` and update the dedupe to read from a
top-level field.

### O6. No client-side gate on illegal-mode `open_window` {#o6}
**Severity 3.** Surfaced by C. Verified: BC §C1.

The system prompt forbids opening `brief`/`workflow`/`stack`/`waffle`/
`playbooks` in windowed mode. `agent-client.ts:58-67` does not check
the mode → kind allow-list. When the LLM opens `brief` in windowed
mode (does happen — see C's q03), the client just opens it.

Fix: enforce the allow-list at the orchestrator tool boundary
(prefer) OR in `agent-client.ts:58-67` as a defense-in-depth check.

### O7. GraphRoom retry overlay is dead code (per-call `.catch(() => [])`) {#o7}
**Severity 3.** Surfaced by D. Verified: D §F2.

`GraphRoom.tsx:71-104` wraps every fetch with `.catch(() => null/[])`,
collapsing errors into empty data. The `loadError`-gated retry
overlay at `:456-470` is unreachable. Backend-down ⇒ "empty graph"
text instead of "backend offline · retry".

Fix: track an `errorCount` outside the inner catches; if any rejected
or `backendHealth` says down, set `loadError` so the existing overlay
fires.

### O8. SettingsRoom `down` chip and `checking…` chip render with the same neutral tone {#o8}
**Severity 4.** Surfaced by D. Verified: D §F1a. **One-line fix.**

`SettingsRoom.tsx:339-345` ternary: `tone === "low" ? "neutral" : "neutral"`.
Both branches return neutral. Should be `tone === "low" ? "low" : "neutral"`.

---

## Secondary objective bugs — fold-in fixes

Smaller defects that are real but subordinate to the above. Each is
worth a line-item; none deserves a sprint of its own.

| ID | Severity | Subagent | Verification | Fix |
|---|---|---|---|---|
| `recentActions` ring buffer hard-capped at 6 | 4 | B | BC §B5 | Bump to 24-32, or replace with session log via O1's chat-history mirror |
| Toolkits silent catch → IntegrationRoom defaults OAuth UI for every slug | 3 | D | D §F4 | Stale-while-revalidate from `localStorage` + degraded banner |
| Optimistic INITIATED mirror runs after `await connectToolkit` | 4 | D | D §F5 | Move write before the await + revert in catch |
| No exponential backoff on health/connections polls | 4 | D | D §F7 | 10→30→60→120→300s capped backoff after first failure |
| `compare` verb has no UI consumer | 4 | B | BC §B4 | Either build the affordance OR retire from agent surface |
| `draft` tool emits a label, no code body | 3 | C | BC §C3 | Either populate `data.code`+renderer OR retire from surface |
| OAuth flow drops user's verbatim message intent on unconnected toolkit | 3 | C | BC §C5 | Capture as `source` card, replay on connection |
| `/api/kg/entities` returns 422 (likely missing required query param) | 3 | A | A §A8 | Backend route audit — out of FE scope |
| q03 (workflow query in chat) produced zero events at all | 4 | B | BC §B2 | Add a "no output" fallback in orchestrate route → toast |

---

## Subjective triage queue — please reproduce

Things that "felt off" but aren't bugs. Each needs you to look at it
in the running app and decide: is the agent's tone okay? is the
discoverability acceptable? do the empty states read right? Mark each
with a vote — keep / soften / change — and we proceed accordingly.

| # | What | Where to look | The complaint |
|---|---|---|---|
| S1 | Empty graph reads as "no data" not "backend down" | open `/`, fire "show me the graph" with backend down → graph room | Founder will think their data is gone |
| S2 | IntegrationRoom OAuth click → 6.5s toast → status stays `not connected` | open integration room, click `connect slack` with backend down | Click → toast disappears → click → toast → loop. No persistent failure state. |
| S3 | `degraded ·` prefix lands in the dock as one tiny mono line that scrolls past in 2s | reach a degraded turn (any `show me X` with backend down) | Invisible signal — user has to know what "degraded" means |
| S4 | Settings is the only honest screen | use the app with backend down for 30s without opening settings | The signal lives where the user least often looks |
| S5 | Spotlight auto-dismisses on a 350ms timer regardless of reply length | submit any query in windowed mode, watch the bar slide away | One-line replies vanish before you can re-read; bar eats your attention then bails |
| S6 | Onboarding bait-and-switch: "tell me about your day" → settings form | first run | The breathing-dot copy primes a voice/conversational moment; click delivers a config form |
| S7 | "saved" chip flip is silent (no animation, no toast unless you noticed) | settings → fill user_id → save | Toast scrolls past, chip changes, no signal of success otherwise |
| S8 | Dock has no room icons, just a voice dot + chat toggle | open the app, look at the dock | Feels like icons were removed without replacement; nothing to click except `/` |
| S9 | `SnapshotInspector` discoverability: behind ⌘⇧S, only chip-hint on screen | toggle inspector via the chip | The "what does the agent see" panel is the harness's most trust-building UI; should be more visible |
| S10 | Refusals are stock strings, no useful next step | "morning brief", "list services" in windowed mode | Reads like an HTTP 405 response — agent acknowledges intent but doesn't suggest "switch to chat for this one" |
| S11 | Chat-mode reply lane feels like a "speaker tube", not a chat | submit any tool-only query in chat mode | 4 of 5 queries produced no chat reply at all (this is O1, but its UX symptom is felt here) |
| S12 | Single-sentence replies feel terse | submit "good morning" in chat mode | Lone sentence with nothing else makes the agent feel inconsistent — sometimes responsive, mostly silent |
| S13 | Chat-input disabled mid-flight (no queue, no cancel) | submit a query, try to type during the wait | Defensive but no ChatGPT-style "stop" or queue affordance |
| S14 | `MessageSquare` chat-toggle on dock is hard to discover | first-time windowed mode | Hover-to-find. Once in chat the WINDOWED pill is obvious; the entry isn't |
| S15 | Auto room-swap in chat mode happens silently | run "show me what's broken" in chat mode | Tab strip relabels with no inline notice "agent switched to graph" |
| S16 | Empty-state suggestion list disappears after first query | open chat mode, send any query | No persistent way to discover the chat lexicon mid-session — no slash menu, no `?` |
| S17 | The `draft` card shows a confidence number with nothing to click | run "draft a python script that sends slack at 9am" | Reads like "I did something" when in fact the agent emitted a label |
| S18 | A code-shape question gets opened as the wrong room | run "find slowest service + logs" in windowed mode | Opens `brief` and `graph` (both wrong) and then refuses; never opens `stack` (the room with the data) |
| S19 | "I can't" is the most common reply shape | mix windowed-mode queries that match brief/workflow/stack | Refusal-heavy interaction in windowed mode; suggests product-shape question about widening allow-list |

---

## Harness-merge implications — what the bugs say about the merge

These objective bugs are signal about which merge bias decisions are
forced vs free. Logged here so they make it into
`merge-principles-2026-04-26.md` (sibling doc) once we make each call.

### O1 forces the chat-history shape

The harness uses Vercel AI SDK `useChat` where each message is
`{ role, parts: [text | tool-invocation | tool-result | …] }`. The
chat panel today is `{ role, text, … }` — flat string. To merge, we
either:

- (a) extend Desmond's `ChatMessage` to carry parts (B's report has the
  exact diff in "Harness-merge implications" §1); or
- (b) build a separate code-interpreter chat surface (option 5b in
  `docs/triage-2026-04-26-ui-harness-sync.md`) that uses `useChat`
  natively and sits inside chat mode as one of the room kinds.

(a) is harness-aligned and also fixes the `compare` / `draft`
silent-tool problems (B4, C3) for free. (b) is faster to ship but
diverges the two chat surfaces.

### O2 says don't trust the orchestrator's prompt to be reliable

Three independent reproductions of "tool-call syntax leaked as text"
across A, B, D = this isn't a Flash-Lite quirk we can prompt-engineer
around once and forget. Any merge that puts the harness's coding tools
behind the same orchestrator inherits this defect. Either:

- The orchestrator stays at Flash-Lite and we rely on the output-side
  scrub (defensive); OR
- The code-interpreter sub-agent runs on a different model (Anthropic
  Sonnet 4.6 per Jordan's harness spec) where tool-calling is more
  reliable.

Per `merge-principles-2026-04-26.md` (and the eval AGENTS.md), the UI
agent stays on Flash-Lite for cost. The harness sub-agent should stay
on Anthropic Sonnet for tool-use reliability. This split is forced by
O2.

### O3 / O5 say don't trust event ordering or shape

The room-tools race (O3) and the slug-payload mismatch (O5) both come
from the orchestrator-tool-to-client envelope being implicit. When the
harness adds new tools, every one needs to round-trip through the
event shape correctly. Best to fix the envelope first (queue tool
calls per room, normalise slug→payload) so the harness doesn't pay
the same costs again.

### O4 says windowed mode needs a layout contract

If the harness ever opens multiple windows for a single intent (e.g.
"open the slack and gmail integrations" → 2 windows), the same
no-fan-out bug bites. The layout-agent retirement was a latency win,
but it left layout principles homeless. Either re-introduce a thin
"layout enforcer" at the store level OR accept that the orchestrator
has to specify rects explicitly for multi-window opens.

### O7 / O8 say don't repeat the empty-vs-error pattern

When the harness gets a backend, every consuming room needs an
explicit `error | empty | ready` distinction. The per-call
`.catch(() => [])` pattern in GraphRoom is a recipe for "looks empty,
actually broken". Don't ship a code-interpreter room with that
pattern — be explicit about loading / error / no-data / backend-down.

---

## What we did NOT test

For honesty, the things this run skipped:

- **Voice loop** (Web Speech API, hold-to-talk on `.`). Headless
  Chromium can't hold a real mic. Worth a manual smoke from you.
- **Real Composio OAuth round-trip**. We tested the connect-click
  failure mode (D §F5) but not a full success flow against a real
  toolkit. Needs `app/main.py` running + a real Composio account.
- **The agent-evals 80-query corpus**. Different machinery, different
  reporting shape. The B/C/D probes are 5 queries each; the eval
  corpus is ~16× larger.
- **Mode-switch with cards in flight**. We tested context preservation
  for rooms but not for transient cards.
- **Refresh during a streaming reply**. Behaviour unspecified.
- **Multiple browser tabs sharing localStorage** beyond the
  cross-tab user_id sync test.
- **Light/dark mode**. Per `web/agent-evals/AGENTS.md` Sprint 1.5: no
  dark mode.

---

## Aggregate counts

- 4 subagents, 4 reports, 4 verification docs.
- ~73 screenshots across the 4 runs.
- 5 console-error logs (43 backend-down + 2 KG 422s + 1+1+1 room-tools
  warnings).
- 8 verified objective bugs (after dedup).
- 9 secondary fold-in fixes.
- 19 subjective items in the triage queue.
- 5 harness-merge implications to bake into `merge-principles`.
