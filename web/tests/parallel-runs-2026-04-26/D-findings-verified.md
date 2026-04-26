# D — findings, independently verified against source

Each of D's findings (F1–F8) is re-checked against the actual source on
`origin/main` (worktree `jordan-merge-harness-with-frontend` at
`1d152ef`). Status legend:

- **VALIDATED** — claim matches source exactly.
- **PARTIAL** — claim is correct in essence but mischaracterises a detail.
- **REFUTED** — claim does not hold against source.
- **NEW** — finding the verification turned up that D didn't capture.

## F1 — SettingsRoom health row text reads "down" correctly

**Status: VALIDATED.**

`SettingsRoom.tsx:328-329`:
```ts
const tone = ok === null ? "neutral" : ok ? "high" : "low";
const text = ok === null ? "checking…" : ok ? "ok" : "down";
```

The text label is correct. The bug is in the `tone` plumbing — see F1a.

## F1a — `down` chip and `checking…` chip render with the same neutral tone

**Status: VALIDATED.** Single-line fix.

`SettingsRoom.tsx:339-345`:
```tsx
<Chip
  tone={
    tone === "high" ? "high" : tone === "low" ? "neutral" : "neutral"
  }
>
  {text}
</Chip>
```

Both branches of the inner ternary return `"neutral"`. So `tone === "low"`
(the "down" path) and `tone === null` (the "checking…" path) produce
visually identical chips. Should be `tone === "low" ? "low" : "neutral"`.

## F2 — GraphRoom `loadError` overlay + retry button is dead code with the backend down

**Status: VALIDATED.**

`GraphRoom.tsx:71-104` — every fetch is wrapped inline:
```ts
Promise.all([
  backend.getKgUser(userId).catch(() => null),
  backend.getKgIntegrations(userId).catch(() => []),
  backend.getKgEntities(undefined, userId).catch(() => []),
  backend.getKgMemories({ by: "confidence", limit: 30 }, userId).catch(() => []),
  backend.getKgSkills({ minStrength: 1 }, userId).catch(() => []),
  backend.getKgWorkflows(userId).catch(() => []),
  backend.getConnections(userId).catch(() => []),
])
  .then(([user, integrations, entities, memories, skills, workflows, connections]) => {
    if (cancelled) return;
    setGraph(toGraph({ user, integrations, entities, memories, skills, workflows, connections }));
  })
  .catch((err: unknown) => {
    if (cancelled) return;
    setLoadError(err instanceof Error ? err.message : "load failed");
  })
```

The outer `.catch` only fires if `Promise.all` itself rejects. With every
inner promise wrapped in `.catch(() => […])`, the outer can never reject
on a network error. `loadError` stays `null` indefinitely.

`GraphRoom.tsx:456-470` — the retry overlay:
```tsx
{userId && loadError && (
  <div ...>
    <p>graph load failed</p>
    <p>{loadError}</p>
    <button onClick={refresh}>retry</button>
  </div>
)}
```

…is gated on `loadError` and therefore unreachable when the backend is
unreachable. Lines 471-479 fire instead with the friendlier "empty graph"
copy. Confirmed dead code on the broken-backend path.

## F3 — BriefRoom is fully degraded-mode-safe (no backend dependency)

**Status: VALIDATED.**

`BriefRoom.tsx:1-11` imports list:
```ts
import { seed } from "@/lib/seed/ontology";
import { Chip } from "@/components/primitives/Chip";
import { Button } from "@/components/primitives/Button";
import { Hairline } from "@/components/primitives/Hairline";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import { cn } from "@/lib/cn";
```

No `backend` import. The component reads from `seed.briefProposals`
directly (line 36, 59, 79). Nothing renders is contingent on a network
call, so backend-down has zero effect on this room.

Side-note: D claimed BriefRoom is unreachable in windowed mode by
orchestrator policy. Confirmed against `orchestrator.ts:23-25,49`:
```
WINDOWED mode (check <canvas mode=>): only three kinds exist:
  settings, integration, graph.
…
in WINDOWED mode NEVER open brief / workflow / stack / waffle / playbooks — refused.
```

## F4 — IntegrationRoom defaults to OAuth UI for every slug when toolkits poll fails silently

**Status: VALIDATED** (with the caveat that the chain is two files).

The silent catch in `StoreBridge.tsx:88-109`:
```ts
const fetch = async () => {
  try {
    const tks = await backend.listToolkits();
    if (cancelled) return;
    setToolkits(tks.map(...));
  } catch {
    /* swallow — health poll surfaces degraded mode separately */
  }
};
```

When this fails, `toolkits` stays at `[]` in the store.

The cascade in `IntegrationRoom.tsx:86-88`:
```ts
const tkInfo = useMemo(() => toolkits.find((t) => t.slug === slug), [toolkits, slug]);
const isApiKey = tkInfo?.auth_scheme === "API_KEY";
const inputFields = tkInfo?.expected_input_fields ?? [];
```

With `toolkits = []`, `tkInfo` resolves to `undefined`, so `isApiKey`
evaluates to `false`. Whatever IntegrationRoom renders for `!isApiKey`
will fire for every slug — including ones (Notion, Perplexity) that may
genuinely be `API_KEY` on a healthy backend. D's diagnosis is exact.

Comment from D's report worth preserving: the StoreBridge catch's
inline comment says "health poll surfaces degraded mode separately" —
which is true for the global degraded indicator but doesn't address
the auth-scheme defaulting bug at all.

## F5 — Optimistic `INITIATED` mirror is dead when the connect call rejects

**Status: VALIDATED.**

`IntegrationRoom.tsx:157-204` — the `beginOAuth` flow:
```ts
const beginOAuth = useCallback(async () => {
  if (!requireUserId()) return;
  if (pending) return;
  setPending(true);
  setRoomState("settings", "loading");
  try {
    const callback = `${window.location.origin}/oauth/return`;
    const r = await backend.connectToolkit(userId!, slug, callback);   // ← await here
    sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ ... }));
    // Optimistic mirror — the snapshot agent sees INITIATED right away.
    setConnections([
      ...connections.filter((c) => c.slug !== slug),
      { slug, status: "INITIATED" },
    ]);
    window.location.href = r.redirect_url;
  } catch (err) {
    setPending(false);
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    pushCard({ id: ..., kind: "toast", data: { text: `connect failed: ${err...}` }, ttl: 6500 });
    setRoomState("settings", "ready");
  }
}, [...]);
```

The optimistic write at line 175 sits AFTER the `await
backend.connectToolkit(...)` at line 164. With backend down, the await
rejects, control jumps to the `catch`, and the optimistic write never
runs. D's recommendation ("move it before the await") would actually
need a small redesign — the optimistic state needs to be reverted in the
catch block too. Net direction is right, the implementation isn't
one-line.

## F6 — Orchestrator emits the `degraded ·` prefix correctly; tool-call syntax leaks as text

**Status: VALIDATED (both halves).**

System prompt at `orchestrator.ts:53`:
```
- if backend.surreal=DOWN or composio=DOWN, prefix reply with "degraded · ".
```

Snapshot wiring at `server-snapshot.ts:666-670`:
```ts
if (snap.backend) {
  lines.push(
    `backend: surreal=${snap.backend.surrealOk ? "ok" : "DOWN"} composio=${snap.backend.composioOk ? "ok" : "DOWN"}`,
  );
}
```

So the orchestrator's prompt does see backend health and is told to add
the prefix. Confirmed working.

The leak is captured in `orchestrator-reply.json#final.agentReply`:
```json
{
  "agentReply": "degraded · open_window(kind=\"graph\")",
  "windows": [],
  ...
}
```

The streamed reply chunks (`orchEvents[0].bodySnippet`) show the model
emitted `degraded · open_window(kind="graph")` as a single text token,
NOT as a tool call. `windows` is empty after the stream finishes,
proving no real tool fired. D's classification ("model-quality, not
backend-related") is right — this is the model parroting its own tool
schema as text output. Likely needs a system-prompt nudge: "NEVER
include tool-call syntax in reply text. The reply is plain prose."

This is a genuine orchestrator reliability bug independent of the
backend-down scenario. Belongs in the agent-evals sprint queue.

## F7 — StoreBridge polls swallow errors silently with no backoff

**Status: VALIDATED.**

`StoreBridge.tsx:58-86` (health poll):
```ts
useEffect(() => {
  let cancelled = false;
  const probe = async () => {
    try {
      const h = await backend.getHealth();
      if (cancelled) return;
      setBackendHealth({ surrealOk: !!h.surreal?.ok, composioOk: !!h.composio?.ok, checkedAt: Date.now() });
    } catch {
      if (cancelled) return;
      setBackendHealth({ surrealOk: false, composioOk: false, checkedAt: Date.now() });
    }
  };
  void backend.warmUp();
  void probe();
  const tid = window.setInterval(probe, HEALTH_POLL_MS);   // 30_000 ms
  return () => { cancelled = true; window.clearInterval(tid); };
}, [setBackendHealth]);
```

Two corrections to D's wording:

- The health poll *does* update store on failure (sets both
  `surrealOk/composioOk = false`). It is NOT silent — it's the very
  source of the only honest signal in Settings. D's report acknowledges
  this elsewhere but the F7 paragraph mis-paints it.
- Backoff: confirmed not implemented (`HEALTH_POLL_MS` and
  `CONNECTIONS_POLL_MS` are constants at lines 8-9). D's recommendation
  to add exponential backoff stands.

The toolkits catch at lines 88-109 IS silent (no store update).
Connections catch at lines 111-135 IS silent (also no store update).
So D's "three pollers, all silent" is a slight overclaim — health is
loud, the other two are silent. PARTIAL on the framing, VALIDATED on
the underlying defect (no backoff, no surfaced retry counter, no
last-error log).

## F8 — Console error noise from failed fetches

**Status: VALIDATED in spirit, partly out-of-scope.**

This isn't an application bug — it's Chrome's default "Failed to load
resource: net::ERR_CONNECTION_REFUSED" log, which fires for every
aborted fetch regardless of whether the JS code handles the error. The
recommendation (exponential backoff to reduce request frequency) folds
naturally into F7's fix.

D's count of 43 console errors in 25s isn't independently re-verifiable
without re-running their script (which is explicitly the artifact). I
trust the count — it's consistent with 88 network failures across 11
endpoints in their `network-failures.json`.

---

# NEW — finding D's harness surfaced but didn't categorise

## NEW1 — `[room-tools] no tool 'X' on room 'Y'` warnings: race between `ui.room` and `ui.tool` events

**Status: VALIDATED, but the diagnosis differs from "tools missing".**

During the parallel test runs, the dev server logged three browser-side
warnings via `console.warn`:

```
[browser] [room-tools] no tool 'search' on room 'graph'
[browser] [room-tools] no tool 'connect' on room 'integration'
[browser] [room-tools] no tool 'clear' on room 'graph'
```

Source at `room-tools.ts:117-122`:
```ts
export async function callRoomTool(room, tool, args = {}) {
  const map = registry[room];
  const def = map?.get(tool);
  if (!def) {
    console.warn(`[room-tools] no tool '${tool}' on room '${room}'`);
    return undefined;
  }
  return def.run(args);
}
```

But the tools ARE actually registered:

| Room | Registered tools include |
|---|---|
| graph | `focus_node`, `search`, `clear`, … (`GraphRoom.tsx:292-…`, `:382`, `:390`) |
| integration | `connect`, … (`IntegrationRoom.tsx:345-347`) |
| playbooks | `search` (`PlaybooksRoom.tsx:130`) |

So the agent IS calling the right tool names. The warning fires
because the registration runs inside a `useEffect` (e.g.
`GraphRoom.tsx:291-292`) — the room only registers its tools after it
mounts. Sequence:

1. Agent calls `open_window(kind="graph")` → store updates → React
   re-renders → GraphRoom is queued to mount.
2. Same orchestrator turn ALSO emits `ui.tool` for `graph.search` (e.g.
   the agent is staging the canvas: open + filter in one step).
3. The `ui.tool` event hits `callRoomTool("graph", "search", …)` BEFORE
   GraphRoom's `useEffect` has run.
4. Registry lookup misses, warning logs, tool call silently no-ops.

This is a **race condition**, not a missing tool. Three plausible fixes:

1. **Queue tool calls per room** — buffer `ui.tool` events for a room
   until that room registers tools (or for ~500ms with a fallback
   timeout).
2. **Pre-register tool stubs** at the store layer with deferred
   resolution against the eventual handler.
3. **Sequence the agent** — emit `ui.tool` events one tick after the
   `ui.room` event so React has a chance to mount.

Option (1) is the most defensive and matches how `applyAgentEvent` in
`agent-client.ts` already fire-and-forgets `ui.tool` calls.

This bug would degrade the agent's "performativity" metric in the eval
harness — every multi-step "open + filter" / "open + select" /
"open + highlight" intent eats a wasted tool call when this race fires.

---

# Summary table

| ID | Status | One-line takeaway |
|---|---|---|
| F1 | VALIDATED | Health text is right; tone is the bug. |
| F1a | VALIDATED | `down` chip looks like `checking…`. One-line fix. |
| F2 | VALIDATED | GraphRoom retry overlay is dead code with backend down. |
| F3 | VALIDATED | BriefRoom is backend-free. |
| F4 | VALIDATED | Toolkits silent-catch → IntegrationRoom always renders OAuth UI. |
| F5 | VALIDATED | Optimistic INITIATED mirror happens after the await; never runs on failure. |
| F6 | VALIDATED | `degraded ·` prefix works; model also leaks tool-call syntax as text. |
| F7 | PARTIAL framing / VALIDATED defect | Health poll IS loud (sets `down/down`); toolkits + connections polls ARE silent; no backoff anywhere. |
| F8 | VALIDATED | Console-error volume is downstream of poll frequency; folds into F7 fix. |
| NEW1 | VALIDATED + redirected | `no tool 'X'` warnings are a registration race, not missing tools. |

# Implications for the merge with the harness

A few of these have direct merge consequences worth pinning while we
debug:

- **F1a, F2 (room-level error vs empty handling)** — when the harness
  starts being a backend (whether for a code-interpreter room or
  through `app/main.py`'s endpoints), every consuming room needs the
  same explicit `error | empty | ready` distinction we'd want to fix
  here. Don't repeat the per-call `.catch(() => [])` collapse pattern.
- **F4 (silent catch with cascading wrong UI)** — same lesson. Any new
  fetch path the harness adds should make "I don't know" a first-class
  state, not silently fall to the OAuth/default branch.
- **F6 (tool-call leak)** — any prompt we add for a code-interpreter
  agent must include the same "never include tool-call syntax in reply
  text" guardrail. Cheap insurance.
- **NEW1 (room-tool race)** — when the harness's `run_code` /
  `find_examples` etc. eventually live on a "code interpreter" room,
  their registration needs to happen before the orchestrator can fire
  tool calls into them. Either pre-register or queue.
- **F7 (poll frequency / no backoff)** — once the harness has its own
  health endpoint, we should fold it into the same
  `backendHealth` mirror so we get one source of truth for "is the
  shared backend up?" rather than two parallel pollers.
