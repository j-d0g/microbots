# D — Backend-down failure surface

Run date: 2026-04-26.
Harness: `run.mjs` (full session) + `run-orchestrator.mjs` (focused command-bar test).
Setup: Playwright Chromium aborts every request to `app-bf31.onrender.com`
(the configured `NEXT_PUBLIC_MICROBOTS_BASE_URL`) with `ERR_CONNECTION_REFUSED`,
which is exactly what `backend.ts`'s `try/catch` translates into
`BackendError("Failed to fetch", 0)`.

## Summary

When `app/main.py` is down (and the configured Render base is unreachable)
the app **boots, onboards, and renders every screen without crashing** — but
the user is then dropped into a quietly broken canvas where every backend-
dependent feature looks _empty_ rather than _broken_. The single source of
truth is the `backendHealth` mirror in `useAgentStore`, polled every 30 s by
`StoreBridge`. That mirror correctly flips both flags to `down` after the
first failed probe, and the orchestrator picks it up: every reply gets a
`degraded · ` prefix as the `lib/agent/orchestrator.ts` system prompt
mandates. The only place a user sees those flags rendered today is the
**Settings → backend** card (two `down` chips). Everywhere else, the UI
silently swallows the network error: GraphRoom shows the friendly empty
state ("empty graph — connect a tool to start filling this in"),
IntegrationRoom shows a clean `connect slack` button as if Composio were
healthy, the connections poll/toolkits poll/health poll all fail without a
toast or banner. The only loud failure mode is the Composio OAuth POST,
which surfaces a transient toast ("connect failed: Failed to fetch"). Net
result: the user can drive the orchestrator to "open graph", get the
`degraded ·` prefix in the dock, see the empty graph, and _reasonably
conclude they have no data_ — not that the backend is down.

## Objective findings

### F1. SettingsRoom — health badges go `down` correctly (the **only** clear surface)

- WHAT: After the first `/api/health` probe fails, both rows render
  `surrealdb · down` and `composio · down`. The `refresh` button visibly
  returns to its idle label (`refresh`, not `…`) so the user can tell the
  probe completed.
- WHERE: `web/components/rooms/SettingsRoom.tsx:67-85` (`refreshHealth`,
  catch sets `{ surrealOk: false, composioOk: false }`); rendered at
  `:312-321` via `HealthRow`.
- EVIDENCE: `screenshots/04-health-after-refresh.png`,
  `phases.json#phase2-health-post-refresh` →
  `{"surrealText":"surrealdbdown","composioText":"composiodown",
  "backendHealth":{"surrealOk":false,"composioOk":false,…}}`.
  Note the badge tone is `neutral` ("ok" → `high`, "down" → `neutral`),
  i.e. `surrealdb down` looks visually identical to `surrealdb checking…`.
  See F1a below.

### F1a. SettingsRoom — `down` chips render with the same `neutral` tone as `checking…` (visual bug)

- WHAT: `HealthRow` always passes `tone="neutral"` to `<Chip>` whether the
  status is `down` or `checking…` because the conditional is
  `tone === "high" ? "high" : tone === "low" ? "neutral" : "neutral"`.
- WHERE: `web/components/rooms/SettingsRoom.tsx:339-345`.
- EVIDENCE: visible chip text says `down` but its tone class never changes.
  No red, no warning glyph. The badge is _technically_ correct but visually
  understated — easy to miss at a glance.

### F2. GraphRoom — backend down ⇒ "empty graph" (looks like no data, not down)

- WHAT: Each of the 7 KG calls (`getKgUser`, `getKgIntegrations`,
  `getKgEntities`, `getKgMemories`, `getKgSkills`, `getKgWorkflows`,
  `getConnections`) is wrapped in `.catch(() => null/[])` so every failure
  becomes "no data". `toGraph(...)` then produces 0 nodes / 0 edges, which
  trips the empty-state branch.
- WHERE: `web/components/rooms/GraphRoom.tsx:71-108` (Promise.all with
  per-call catches), `:471-480` (the `empty graph — connect a tool to
  start filling this in.` overlay).
- EVIDENCE: `screenshots/05-graph-room.png`,
  `phases.json#phase3-graph-state` →
  `{"noUserVisible":false,"visibleText":["empty graph",
  "connect a tool to start filling this in.", …]}`.
  `loadError` stays `null`, so the red error overlay (`graph load failed`)
  at `:456-470` **never** triggers. With backend down, the only paths a
  user can reach are: `no userId` (set userId in settings) or `empty
  graph` (looks like a fresh account). The retry button only renders
  inside the `loadError` branch which is unreachable here.

### F3. BriefRoom — fully degraded-mode-safe (no backend dependency)

- WHAT: BriefRoom reads from `seed.briefProposals` only. Backend down has
  zero effect on it.
- WHERE: `web/components/rooms/BriefRoom.tsx:1-89` — only imports
  `@/lib/seed/ontology`. Zero backend calls.
- EVIDENCE: `screenshots/06-brief-room-chat-mode.png`,
  `phases.json#phase4-brief-state` → `{"cardCount":6,"hasYesterday":true}`.
  All 6 proposals + yesterday strip render fine. Note: BriefRoom is
  unreachable in windowed mode by orchestrator policy — confirmed via
  the `ORCH_SYSTEM` prompt at `lib/agent/orchestrator.ts:49`. We had to
  flip to `chat` mode to test it.

### F4. IntegrationRoom — toolkits poll fails ⇒ misleading OAuth-only UI

- WHAT: `StoreBridge` calls `listToolkits()` once on mount; with backend
  down it fails, the catch is empty (`/* swallow */`), and `toolkits`
  stays `[]`. In IntegrationRoom, `tkInfo` therefore resolves to
  `undefined`, `isApiKey = tkInfo?.auth_scheme === "API_KEY"` evaluates
  to `false`, and the OAuthConnectState is rendered **for every slug** —
  even ones (Notion, Perplexity) that may actually be `API_KEY` on the
  live backend. The user sees a clean `connect slack` button and the
  copy "you'll be redirected to composio to authorize access".
- WHERE: `web/components/agent/StoreBridge.tsx:88-109` (silent catch);
  `web/components/rooms/IntegrationRoom.tsx:86-88,428-438`.
- EVIDENCE: `screenshots/07-integration-slack.png`,
  `phases.json#phase5-slack-state` →
  `{"connectButtonVisible":true,"connectButtonText":"connect slack",
  "connections":[],"toolkits":[]}`. No banner, no badge, no hint that
  Composio is unreachable. Status chip says `not connected` (the
  `default` branch of `StatusChip`), which is identical to "user has
  never connected slack on a healthy backend".

### F5. Composio OAuth click — surfaces a toast (loud, but generic)

- WHAT: Clicking `connect slack` calls `connectToolkit(...)` which fires
  `POST /api/composio/connect` → fails → `BackendError("Failed to
  fetch", 0)` → catch in `beginOAuth` pushes a toast: "connect failed:
  Failed to fetch", `ttl=6500`. The `INITIATED` optimistic mirror is NOT
  applied because the throw beats it (`backend.connectToolkit` rejects
  before `setConnections([..., {slug, status: "INITIATED"}])` runs).
  `pending` is reset, `setRoomState("settings","ready")` clears the
  overlay.
- WHERE: `web/components/rooms/IntegrationRoom.tsx:157-204` (`beginOAuth`
  full body, including the catch at `:181-193`).
- EVIDENCE: `screenshots/08-after-connect-click.png`,
  `phases.json#phase6-after-connect-click.cards` →
  `{"id":"toast-err-slack-…","kind":"toast","data":{"text":"connect
  failed: Failed to fetch"},"ttl":6500}`. This is the **only** error
  surfacing in the entire session that the user can read.

### F6. Orchestrator — knows about degraded mode and prefixes "degraded · "

- WHAT: Server snapshot includes `backend: surreal=DOWN composio=DOWN`
  (per `web/lib/agent/server-snapshot.ts:666-668`). The orchestrator
  system prompt instructs "if backend.surreal=DOWN or composio=DOWN,
  prefix reply with 'degraded · '" (`web/lib/agent/orchestrator.ts:53`).
  Tested: with backend down, query "show me the graph" yielded reply
  `"degraded · open_window(kind=\"graph\")"` (literal text).
- WHERE: `lib/agent/orchestrator.ts:21-55` (system prompt),
  `lib/agent/snapshot.ts:135-141` (backend mirror in snapshot).
- EVIDENCE: `orchestrator-reply.json#final.agentReply`. Two issues:
  1. **Behaviour is correct**: prefix appears.
  2. **Bug observed in passing**: the model leaked the tool-call syntax
     as text (`open_window(kind="graph")`) instead of calling the tool.
     The `windows` array stayed empty after the stream finished. Not
     necessarily a backend-down issue — flag for the orchestrator
     reliability sprint.

### F7. StoreBridge polls — silently failing every 30 s

- WHAT: Three pollers: `/health` warmUp + `/api/health` probe (every
  30 s), `/api/composio/toolkits` (one-shot on mount), and
  `/api/composio/connections?user_id=…` (every 30 s when userId set).
  All three swallow errors with empty catches. The health one updates
  the store; the other two leave stale state. No counter, no last-error
  log, no exponential backoff — every 30 s the browser fires a new
  failing request.
- WHERE: `web/components/agent/StoreBridge.tsx:58-86` (health),
  `:88-109` (toolkits — only fires once), `:111-135` (connections).
- EVIDENCE: `network-failures.json` shows 5 attempts on `/api/health`,
  3 on `/health` (warmUp), 7 on `/api/composio/connections`, 3 on
  `/api/composio/toolkits` over a ~25 s session.

### F8. Console error noise — every failed fetch logs `Failed to load resource: net::ERR_CONNECTION_REFUSED`

- WHAT: Chrome's default network error logging fires for every aborted
  fetch. 43 console errors collected in a 25-second session, all
  resource-load errors, none unhandled. No JS exception, no React
  warning, no unhandled promise.
- WHERE: not application code — chrome devtools surface.
- EVIDENCE: `console-errors.json`. Useful for triage; confusing for an
  end user who pops the inspector during a demo.

## Subjective findings

- **Graph room is the worst offender.** A founder who has a populated
  KG opens the graph room and sees "empty graph — connect a tool to
  start filling this in.". They will conclude either (a) their data is
  gone, or (b) the agent forgot them. Nothing on screen says "we
  couldn't reach the backend, your data is fine, refresh later". The
  retry button is gated behind `loadError` which never triggers because
  every individual fetch is `.catch(() => [])`.
- **IntegrationRoom OAuth flow is a trap.** The user clicks `connect
  slack` and gets a transient 6.5 s toast that disappears. If they're
  looking at the graph, they miss it entirely. The status chip stays at
  `not connected`, not `failed`. Five seconds later they click again
  and get the same toast. Loop.
- **The orchestrator's `degraded · ` prefix is the right idea but
  invisible.** The prefix lands in the dock as one tiny font-mono line
  that scrolls past in 2 s. The user has to know what `degraded` means
  and to associate it with "the backend is down, not me being slow".
  No other affordance reinforces it (the dock and command-bar reply
  share the same string; nothing else changes).
- **Settings is the only honest screen.** It does say `surrealdb · down
  · composio · down`. But: (i) the Chip tone is identical to
  `checking…`, so it doesn't read as "alarm"; (ii) Settings is
  `right-wide` by default and won't be open when the user hits
  `/integration` or `/graph` first. The signal lives where the user
  least often looks.
- **OnboardingRoom doesn't probe at all** — fine if you trust the
  workflow, but it means a user can complete onboarding, type a
  user_id, hit save, and never see a degraded-mode hint until they
  manually open settings or notice the toast on a connect attempt.

## API call inventory

All counts are over the ~25 s scripted session (run.mjs phases 1-8). The
first column is the user-visible feature, the second the absolute path on
the configured `BASE_URL` (https://app-bf31.onrender.com), the third the
HTTP method, the fourth what the browser actually saw, the fifth the
visible UI consequence.

| Feature | Endpoint | Method | Result | UI consequence |
| --- | --- | --- | --- | --- |
| StoreBridge warm-up (every 30 s) | `/health` | GET | 3× `ERR_CONNECTION_REFUSED` | none |
| StoreBridge health poll (every 30 s) | `/api/health` | GET | 5× `ERR_CONNECTION_REFUSED` | `backendHealth.surrealOk/composioOk = false`; Settings shows `down/down` |
| Toolkits discovery (mount + StoreBridge) | `/api/composio/toolkits` | GET | 3× `ERR_CONNECTION_REFUSED` | `toolkits = []`; **silent**; cascades into IntegrationRoom mis-rendering OAuth UI for every slug |
| Connections poll (every 30 s when userId set) | `/api/composio/connections?user_id=test_e2e_d` | GET | 7× `ERR_CONNECTION_REFUSED` | `connections = []`; **silent**; chip stays `not connected` |
| Graph room load — user profile | `/api/kg/user` | GET | 4× `ERR_CONNECTION_REFUSED` | swallowed by `.catch(() => null)` |
| Graph room load — integrations | `/api/kg/integrations` | GET | 4× `ERR_CONNECTION_REFUSED` | swallowed by `.catch(() => [])` |
| Graph room load — entities | `/api/kg/entities` | GET | 4× `ERR_CONNECTION_REFUSED` | swallowed by `.catch(() => [])` |
| Graph room load — memories | `/api/kg/memories?by=confidence&limit=30` | GET | 4× `ERR_CONNECTION_REFUSED` | swallowed by `.catch(() => [])` |
| Graph room load — skills | `/api/kg/skills?min_strength=1` | GET | 4× `ERR_CONNECTION_REFUSED` | swallowed by `.catch(() => [])` |
| Graph room load — workflows | `/api/kg/workflows` | GET | 4× `ERR_CONNECTION_REFUSED` | swallowed by `.catch(() => [])` |
| OAuth start (Slack connect click) | `/api/composio/connect` | POST | 1× `ERR_CONNECTION_REFUSED` | toast "connect failed: Failed to fetch" (6.5 s); `pending` resets; status stays `not connected` |
| Integration KG slice (`refreshDetail`) | `/api/kg/integrations/{slug}?limit=10` | GET | not fired in this session — only triggered on `status==="ACTIVE"` | n/a (would set `detailError`, surfaced in `ActiveState`) |
| KG memory write (agent tool) | `/api/kg/memories` | POST | not fired | scaffolded only |
| KG entity upsert (agent tool) | `/api/kg/entities` | POST | not fired | scaffolded only |

Per-endpoint failure totals are also dumped to `network-failures.json#perEndpoint`.

## Recommendations

### A single global "backend offline" indicator

Today the only honest signal is the Settings backend card. Recommend
**adding a thin status row** somewhere always-visible — e.g. in the
`FloatingDock` itself, or as a chip next to the dock-text. The
`backendHealth` mirror is already in the store and already polled every
30 s, so it's a 5-line render change:

```tsx
{backendHealth && (!backendHealth.surrealOk || !backendHealth.composioOk) && (
  <Chip tone="low">backend offline</Chip>
)}
```

Bonus: surface the same chip in IntegrationRoom's header (next to
`StatusChip`) and on top of GraphRoom (next to the existing `refresh`
button). This kills the empty-vs-error ambiguity without rewriting
every catch.

### Rooms that need explicit empty-vs-error states

- **GraphRoom**: `Promise.all` with per-call catches collapses error
  into empty. Track `loadError` distinctly: if `backendHealth` indicates
  `down` OR if any of the 7 calls actually rejected (count outside the
  inner catches), render the existing `loadError` overlay copy with
  "backend offline — your data is safe, retry in a sec." The retry
  button already exists; it just never fires.
- **IntegrationRoom**: when `toolkits == []` AND `backendHealth` is
  `down`, render a banner ("composio offline — connect actions are
  paused") instead of the OAuth `connect` button. Currently a click
  produces a toast and an indistinguishable "not connected" state.
- **SettingsRoom HealthRow**: change the `down` tone to `low` (red) so
  the chip reads as alarm, not as "checking". Single-line fix in
  `:340-343`.

### Calls that should be lazy / cached / optional

- `listToolkits()` is called on every mount in `StoreBridge`. Cache it
  in `localStorage` so the UI has *something* (last-seen auth schemes)
  even when offline — the auth_scheme picker between OAuth-popup and
  API-key-form depends on it and currently silently defaults to OAuth
  for everyone.
- `getConnections()` similarly: stale-while-revalidate from
  `localStorage` so users can at least see "last we knew, slack was
  ACTIVE" instead of `not connected` after a refresh.
- The `/health` warmUp and `/api/health` probe both happen every 30 s.
  Consider exponential backoff once the first probe fails (e.g.
  10s → 30s → 60s → 2m → 5m, capped) to reduce console-error noise and
  battery drain.
- The graph-room data fetch fires 7 calls on every mount. Memoize per
  `userId` with a 60 s TTL — closing & reopening the graph window
  shouldn't re-burn 7 failed requests.

### Outright bugs

1. **GraphRoom loadError unreachable.** Per-call `.catch(() => [])`
   means `loadError` is always `null`, so the existing red `graph load
   failed` overlay + retry button at `:456-470` is dead code with the
   backend down. (`web/components/rooms/GraphRoom.tsx:71-104`.)
2. **HealthRow tone constant for `down` vs `checking…`.** The ternary
   `tone === "low" ? "neutral" : "neutral"` makes "down" visually
   identical to "checking". Should be `"low"`.
   (`web/components/rooms/SettingsRoom.tsx:339-345`.)
3. **Toolkits cache stale → IntegrationRoom defaults to OAuth for
   API_KEY toolkits when backend is reachable but cold/slow.** Same
   silent catch pattern means the wrong connect form will render
   transiently every cold start. (`web/components/agent/StoreBridge.tsx:88-109`.)
4. **`refreshConnections()` in IntegrationRoom returns `[]` on error
   (`:121-123`) — same silent swallow.** A user who just completed
   OAuth in another tab and hits "refresh" sees `not connected`
   indistinguishable from a real backend outage.
5. **Optimistic `INITIATED` mirror is dead with backend down.** The
   `setConnections([..., {slug, status:"INITIATED"}])` line at
   `IntegrationRoom.tsx:174-178` runs only after `connectToolkit()`
   resolves. With backend down it never resolves, so the user can't
   tell "I tried to connect" from "I never tried". Move the optimistic
   write before the await.
6. **Orchestrator tool-call leak (drive-by).** With backend down,
   `"show me the graph"` returned reply text
   `"degraded · open_window(kind=\"graph\")"` and no window opened.
   Probably model-quality, not backend-related — but logged in
   `orchestrator-reply.json` for the next agent-evals sprint.
7. **No exponential backoff on health/connection polls.** Every 30 s
   the browser fires 3 doomed requests, generating console errors and
   keeping a partial network log. Visible to anyone running devtools
   during the demo.

## Artifacts

- `run.mjs` — primary harness, 8 phases, 11 screenshots
- `run-orchestrator.mjs` — focused orchestrator-prefix test
- `screenshots/01..11` — UI states across the run
- `screenshots/12..13` — orchestrator focused run
- `network-failures.json` — full request log (88 events, 11 unique endpoints)
- `console-errors.json` — 43 console errors, all `ERR_CONNECTION_REFUSED`
- `phases.json` — per-phase store/DOM snapshots
- `orchestrator-reply.json` — store samples + reply text from the focused test
