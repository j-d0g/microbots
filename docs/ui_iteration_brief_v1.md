# microbots UI — iteration v1 brief (for the cloud agent)

This is the working brief for cloud-Devin's e2e iteration on `/web`. Read this first, then `docs/ui_scope_v1.md` (the full scoping plan) for any depth you need.

---

## Locked product decisions (do NOT relitigate these)

| Axis | Decision |
|---|---|
| Agent runtime | **Real LLM via OpenRouter, fake in-memory DB.** Pydantic AI tool harness exposing the §4 vocabulary (rooms / verbs / cards). LLM key in env as `OPENROUTER_API_KEY`. Recommended model: `anthropic/claude-sonnet-4` or `openai/gpt-4.1` — pick the cheapest that supports tool-calling well. |
| Architecture | **Single shell + picture-in-picture stackable modals.** First modal is full-surface; subsequent modals open as 480×320 floating panels the user can drag, dock to corners, or expand back to full. **Not** routes — a single `/` route with an in-memory modal stack driven by the agent's `open_room` tool. |
| Voice loop | **Web Speech API** (browser native `SpeechRecognition` + `SpeechSynthesis`). No Deepgram/Cartesia keys. Graceful "voice unavailable" fallback for browsers that don't support it. |
| Scope ceiling | **All 8 rooms polished** (Brief, Graph, Workflow, Stack, Waffle, Playbooks, Settings, Onboarding) hitting the §3 aesthetic + the full states matrix (empty / loading / error / agent-thinking / agent-speaking / deploying / approval-success). Browser tests cover each. |
| Backend integration | **None.** Frontend runs entirely on a fake in-memory ontology that simulates "one night of overnight cron ingest" for a representative startup operator. No SurrealDB, no Composio, no real `knowledge_graph/` calls. |
| Push target | **`https://github.com/desmondzee/microbots`** on branch **`feature/ui-iteration-v1`**. Do **not** push to `j-d0g/microbots` `main`. |

---

## Architectural shift: routes → modal stack

The current `/web` scaffold uses Next.js App Router with one route per room (`/brief`, `/graph`, `/workflow`, etc). That must change.

**New shape:**

- One route: `/` — renders the shell (paper background + floating dock) and a `<ModalStack>`.
- Zustand store holds `modals: Modal[]` where each `Modal` is `{ id, kind: 'brief' | 'graph' | 'workflow' | 'stack' | 'waffle' | 'playbooks' | 'settings', state: 'fullscreen' | 'pip', position?: {x,y} | corner, payload? }`.
- Agent tool `open_room(kind, payload?)` pushes a modal. First modal is `fullscreen`. When a second is pushed and the first is still fullscreen, demote the older one to `pip` (480×320) docked to the bottom-right corner. User can drag PiP modals freely, snap them to corners, or click an expand glyph to make them fullscreen (which demotes the previous fullscreen).
- Cards (§4.4) and toasts continue to render bottom-right above the dock.
- Onboarding + cold-open is a special pre-shell state (no modals, single breathing dot, see §5.1 of `ui_scope_v1.md`).

**Implementation guidance:**

- Use `framer-motion` for the modal transitions (≤240ms, see §3.4 motion).
- Drag with `framer-motion`'s `drag` prop + corner-snap on `onDragEnd`.
- z-index: fullscreen modal at z-10; PiPs at z-20; cards stack at z-30; dock at z-40.
- All modals share a consistent chrome: 1px hairline border, `paper/1` fill, `radius: 8`, optional close glyph in the top-right of PiPs only.
- Keyboard: `Esc` closes the topmost modal; `Cmd+1..7` opens room N as a fullscreen.

---

## Dummy data: "one night of overnight cron ingest" seed

Invent a realistic seed for a single startup operator persona. Suggested:

- **Persona**: Maya Chen, founder of *Inkwell* — a B2B sales-coaching SaaS, 8-person team. Lives in Slack + GitHub + Linear + Gmail + Notion + Perplexity.
- **Memory graph**: ~150 nodes spanning the 5 layers (integration / entity / memory / skill / workflow). Edge density realistic — Slack messages → people → projects, GitHub issues → repos → workflows, etc.
- **Brief room cards** (5–7): mix of confidence:
  - HIGH (≥0.9): "Auto-triage Linear bugs from #product-bugs Slack channel", "Daily digest of overnight GitHub PRs to Maya's inbox".
  - MED (0.7–0.9): "Re-route customer success emails matching `pricing` to Slack #cs-pricing", "Auto-generate weekly investor update from Linear closed tickets".
  - LOW (<0.7): "Summarise Notion meeting notes older than 30d into a quarterly archive".
- **Yesterday's runs**: 5 deployed automations with sparkline data (last 14d trigger counts) + pass/fail dots.
- **Stack room**: 3–5 deployed Python microservices already running (e.g. `slack-linear-bridge@v0.3.1`, `gmail-router@v0.1.0`, `pr-digest@v0.2.0`). Each has logs (last 50 lines, plausibly noisy), schedule, env, health.
- **Workflow room**: 2–3 fully-fledged workflows tied to the deployed services, with both Recipe view and DAG view data ready.
- **Playbook hub**: 4 org playbooks + 6 curated network playbooks + 3 agent-suggested.
- **Settings**: 6 integrations (4 connected, 2 disconnected), 3 org members with mixed roles, default confidence threshold 0.85.

Put this in `web/lib/seed/` as typed TypeScript constants. The agent's tools read/write a Zustand-backed in-memory `MockOntology` that wraps the seed.

---

## Agent tool vocabulary (Pydantic AI on the server, SSE to the browser)

Tools mirror §4 of `ui_scope_v1.md`. Concretely, in `/web/app/api/agent/stream/route.ts`:

**Rooms** (`open_*`):
- `open_brief({ date? })`
- `open_graph({ filter? })` — `filter` is `{ layer?, integration?, since?, query? }`
- `open_workflow({ id })`
- `open_stack({ service_id? })`
- `open_waffle()`
- `open_playbook_hub({ scope? })`
- `open_settings({ section? })`

**Verbs** (act on current room):
- `highlight({ node_id | element_id })`
- `explain({ target, depth? })`
- `compare({ a, b })`
- `draft({ automation_spec })`
- `defer({ card_id, reason })`
- `confirm({ card_id })`

**Cards**:
- `show_card({ kind: 'memory'|'entity'|'source'|'diff'|'toast', data, ttl? })`

The server emits SSE events `ui.room`, `ui.verb`, `ui.card`, `agent.status`, `dock.{idle|listening|thinking|speaking|hidden}`, plus `speak.chunk` for TTS text (which the client passes to `SpeechSynthesis`).

---

## Aesthetic guard-rails (§3 of the scope doc)

- Off-white paper background (`#FBFAF6`), sumi ink (`#1A1A1A`), single indigo accent (`#2E3A8C`).
- Hairline 1px rules for separation. No shadows beyond `rgba(0,0,0,0.04)` if absolutely required.
- `radius: 0` for surfaces, `4` for chips, `8` for dock + cards + modals.
- Type: `Söhne` (or `Inter Tight`) display, `Inter` body, `JetBrains Mono` for IDs/code.
- 12-col grid, 72px outer gutters on desktop. Spacing scale: `4, 8, 12, 16, 24, 32, 48, 64, 96`.
- Motion: ≤240ms `cubic-bezier(0.2, 0.8, 0.2, 1)`. No flashy presets.
- No emojis anywhere in UI copy or code.
- No dark mode in v1.

---

## Browser-test deliverable (Playwright)

Create `web/tests/e2e/` with Playwright tests covering each room + the modal-stack mechanics:

1. **Cold open & onboarding** — page loads, breathing dot present, hint copy visible.
2. **Voice waffle path** — long-press dot opens Waffle modal → fake transcript → toast → memory cards rendered. (Mock `SpeechRecognition` for tests.)
3. **Brief room** — agent emits `open_brief` → cards render with confidence chips → click `Approve` on a card → deploy toast appears.
4. **Graph room** — agent emits `open_graph` → 150 nodes render → `highlight` verb spotlights one → `explain` drops a memory card.
5. **Workflow room** — recipe view default, DAG toggle works, integration chips correct.
6. **Stack room** — 3 services rendered as blocks, click drawer shows logs.
7. **Playbooks** — 3 columns populated.
8. **Settings** — single scrollable column, hairline section dividers.
9. **Modal-stack mechanics** — open Brief, then `open_graph` while Brief still open → Brief becomes PiP, Graph fullscreen → drag PiP to top-left corner → click expand → Graph becomes PiP, Brief fullscreen.
10. **States matrix** — for each room, force the agent to emit `loading`, `empty`, `error`, `thinking`, `speaking`, `deploying`, `approval-success` and verify each renders.

Add an `npm run test:e2e` script. Tests must pass before final push.

---

## Figma deliverables this round

The Figma MCP only supports blank file creation + FigJam diagram generation. Use it for **navigation/state diagrams** as you iterate, not for design frames. At minimum, produce:

1. State machine: `modal_stack` (no modals → 1 fullscreen → 1 fullscreen + 1 PiP → 2 PiPs → ...) with the transitions labelled by tool-calls.
2. Sequence diagram: `waffle_to_memory` (long-press → STT → agent tool calls → memory write → toast).
3. Sequence diagram: `morning_brief_approve_to_deploy` (agent renders cards → user clicks Approve → tool call → deploy toast).
4. State machine: `dock` (idle / listening / thinking / speaking / hidden).

Drop the resulting URLs as a final addendum at the bottom of `docs/ui_scope_v1.md` after each is generated.

For visual design iteration, use the running `/web` app + screenshots committed to `docs/screenshots/` as the design surface. The scope doc's existing blank Figma file URL stays as-is.

---

## Workflow you should follow

1. **Read** `docs/ui_scope_v1.md` cover-to-cover. The decisions above override anything contradictory in there.
2. **Verify** the existing `/web` scaffold runs (`cd web && npm install && npm run dev`). Check all current routes return 200.
3. **Plan** the route → modal-stack refactor as a todo list. Keep it surgical — most existing components in `/web/components/` should be reusable inside modals.
4. **Refactor**: collapse routes into `/` + `<ModalStack>`. Implement Zustand modal state + `open_room` tool integration.
5. **Pydantic AI** real-LLM agent at `/api/agent/stream` (SSE), with the full tool vocabulary. Wire OpenRouter via the existing `agent/` patterns if helpful, otherwise fresh.
6. **Seed** the MockOntology in `web/lib/seed/` with the persona + ontology described above.
7. **Polish each room** to the §3 aesthetic. Don't ship a half-styled room.
8. **Voice** via Web Speech API in the Waffle room. Graceful fallback.
9. **Playwright tests** for the 10 scenarios above. All green.
10. **Browser-use a manual smoke test** in the cloud's headless browser: cold open → waffle → brief → approve → toast. Capture screenshots into `docs/screenshots/`.
11. **Generate Figma diagrams** via the MCP (4 listed above). Append URLs to `docs/ui_scope_v1.md`.
12. **Commit** in logical chunks (refactor / agent / seed / rooms / tests / docs). Conventional commits.
13. **Push** to `https://github.com/desmondzee/microbots` on branch `feature/ui-iteration-v1`. Add `desmondzee` as a remote if it isn't already.
14. **Open a PR** on `desmondzee/microbots` from `feature/ui-iteration-v1` → `main` with screenshots + test results in the body. Do not merge.

---

## Non-negotiables

- No emojis anywhere (UI, copy, commits, comments).
- No dark mode.
- No backend wiring (SurrealDB / Composio).
- No push to `j-d0g/microbots` `main`.
- No `npm run dev` left running in a way that blocks tests.
- No comments removed from existing code unless replacing the whole block.
- No new dependencies that aren't strictly needed (the existing stack — Next 15, React 19, Tailwind 4, shadcn, zustand, framer-motion, react-force-graph-2d — covers everything here except adding `pydantic-ai` server-side and Playwright dev-side).

---

## When you're done

Reply on the cloud session with:

- The PR URL on `desmondzee/microbots`.
- A bullet list of the 4 Figma diagram URLs.
- A note on which OpenRouter model you settled on + approximate per-request cost.
- Any open questions or trade-offs the user should weigh before merging.
