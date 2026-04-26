# microbots — UI Scope v1

A scoped-MVP UI design + Figma scoping plan for microbots, a voice-native, agent-powered workflow engine that replaces operators' SaaS stack with an overnight-generated, one-tap-approve automation graph — designed around a MUJI/Teenage-Engineering aesthetic, a floating dock + generative content area, and a hybrid agent-tool vocabulary of rooms / verbs / cards.

This plan is read-only w.r.t. code; its only output during plan mode is this markdown file. On approval, implementation proceeds in phases starting with the Figma file and design tokens.

---

## 1. Product brief (distilled source-of-truth)

- **What it replaces**: the long tail of SaaS subscriptions a founder/operator glues together (Zapier, n8n, Make, Retool, assorted cron + internal scripts).
- **Core loop**: Composio-ingested signal → memory graph (existing `knowledge_graph/`) → nightly agent classifies updates + unoptimised workflows → pre-computes high-confidence automation candidates → user wakes to a **morning brief** of cards → one-tap approve → agent deploys as modular Python microservices managed in-product.
- **Memory layer as ontology of intent**: already built (`user_profile → integration → entity → chat → memory → skill → workflow`). UI visualises this as a living graph.
- **Waffle mode**: voice-native free-form dumps about pain points / daily workflows → transcribed → ingested as a first-class source alongside integration data. Not Whispr-style dictation; it's "Whispr with hands" — the agent can act on what it hears.
- **Generative UI premise**: the user almost never clicks navigation. The agent paints the screen via a constrained tool vocabulary. Chat history is deliberately absent; memory carries continuity.
- **Enterprise extension**: orgs of operators share a "playbook hub" (internet-of-intelligence) the overnight agent can pull from when writing automations.

Non-goals in v1: billing, fine-grained permissions, non-Python runtimes, mobile app, public playbook marketplace.

---

## 2. Decisions locked (this plan is built on these)

| Axis | Decision |
|---|---|
| Scope | Scoped startup MVP, further than hackathon but not full enterprise. Core product + basic orgs/roles + playbook hub. No billing, no fine-grained perms. |
| Layout | **Floating centered macOS-style dock**; auto-hides while agent is speaking/acting. Light (paper) theme only in v1. |
| Aesthetic | **MUJI / Kinfolk / Teenage Engineering** — off-white paper, hairline 1px rules, generous negative space, mono + neutral grotesque, sumi-black primary with one restrained indigo accent. |
| Visualisations | All four: ontology graph (live, force-directed), recipe workflows (plain English, DAG as power toggle), microservice stack as physical blocks, overnight morning-brief card stack. |
| Voice + agent runtime | **Deepgram STT + Cartesia/ElevenLabs TTS + Pydantic AI** orchestrating tool-calls. |
| Frontend | **Next.js 15 App Router + Tailwind + shadcn (heavily restyled)** in a new `/web` folder alongside `@/Users/desmondzee/Coding/microbots/knowledge_graph` and `agent/`. |
| Approval UX | **One-tap approve + plain-English "why"** per card; "not yet" stores context into memory for tomorrow's run. Voice optional secondary. |
| Agent UI-tool vocabulary | **Hybrid — rooms + verbs + cards.** Rooms are persistent full-surface contexts; verbs act on the current room; cards are transient inline artefacts. |
| Org model | Org + members with owner/admin/member roles + shared org graph overlay + enterprise playbook hub. |
| Figma file | New design file `microbots — UI scope v1` created in `ifactorial` team (`team::1624218988842288042`). Paired FigJam board for navigation flows. |

---

## 3. Design language (tokens + motion)

### 3.1 Palette (paper/sumi with single accent)

| Token | Hex | Role |
|---|---|---|
| `paper/0` | `#FBFAF6` | App background (warm off-white) |
| `paper/1` | `#F4F2EC` | Card/surface raise |
| `paper/2` | `#ECEAE3` | Hover / subtle fill |
| `rule/hairline` | `#D9D6CD` | 1px dividers, graph edges at rest |
| `ink/90` | `#1A1A1A` | Primary type (sumi) |
| `ink/60` | `#5B5B58` | Secondary type |
| `ink/35` | `#9C9A93` | Tertiary / captions |
| `accent/indigo` | `#2E3A8C` | Single accent: active voice dot, approve CTA, selected node |
| `confidence/high` | `#3E7D53` | ≥0.9 automation confidence chip (restrained green) |
| `confidence/med` | `#B8873A` | 0.7–0.9 |
| `confidence/low` | `#A85545` | <0.7 |

No gradients. No shadows beyond a single 1px hairline or a near-invisible `rgba(0,0,0,0.04)` elevation when absolutely required.

### 3.2 Type

- **Display / headings**: `Söhne` or fallback `Inter Tight` — tracking tight, weights 400/500 only.
- **Body**: `Inter` 400, 15/24. Generous leading.
- **Mono (labels, graph IDs, code)**: `JetBrains Mono` 400, 12/18.
- **Headings set in sumi ink**; body in `ink/90`; captions in `ink/60`.

### 3.3 Grid + spacing

- 12-col grid, 72px outer gutters on desktop (generous margins are the brand).
- Spacing scale: `4, 8, 12, 16, 24, 32, 48, 64, 96` px.
- Corner radius: `0` for surfaces (hairlines do the separating), `4` for pills/chips, `8` only for the dock and card stack.

### 3.4 Motion

- All transitions ≤240ms, cubic-bezier `(0.2, 0.8, 0.2, 1)`.
- Room transitions: a single vertical wipe (paper sliding over paper) — no scale, no fade-cross.
- Ink appears: text in agent responses "sets in" char-by-char at ~35ms/char (skippable).
- Voice dot: 1Hz breathing animation in `accent/indigo` when listening; still when idle; a soft bloom on agent speech.

### 3.5 Sound (optional, stretch)

A single wooden tick on approve; silence everywhere else.

---

## 4. Information architecture — shell + rooms

### 4.1 Shell

- **Content plane**: full-viewport, centered 1040px max reading width, everything the agent paints goes here.
- **Floating dock**: centered horizontal pill, 520px wide, 56px tall, `paper/1` fill + hairline border, `radius: 8`. Contents left-to-right:
  1. Voice dot (tap = push-to-talk; long-press = open waffle room).
  2. Agent status line (ink/60, small) — e.g. *"reading your Slack from last night"*.
  3. Micro room switcher — 6 monochrome glyphs for Brief / Graph / Workflows / Stack / Playbooks / Settings. No labels until hover.
- Dock auto-hides (slides 12px down + 70% opacity) while the agent is mid-utterance or mid-animation.
- No header. No sidebar. No breadcrumbs. The room's title appears as the room's own H1.

### 4.2 Rooms (persistent surfaces the agent can open)

| Room | Tool-call | Purpose |
|---|---|---|
| Brief | `open_brief(date?)` | **Hero room.** Morning card stack of pre-computed automation proposals + yesterday's runs + ambient status. Default on wake-up. |
| Graph | `open_graph(filter?)` | Live force-directed ontology graph of the user's memory. Filters: by integration, by entity type, by time window. |
| Workflow | `open_workflow(id?)` | Single workflow as a plain-English recipe (default) or DAG (power-user toggle). Shows the underlying skills + tools + microservice stack. |
| Stack | `open_stack(service_id?)` | Physical-block view of all deployed Python microservices. Stackable/composable; click a block to see logs + schedule. |
| Waffle | `open_waffle()` | Voice room. Near-empty surface, centered prompt *"What's on your mind?"*, breathing dot, live ink transcript appearing beneath (clears after ingest). |
| Playbooks | `open_playbook_hub(scope?)` | Enterprise room: org's shared playbooks + suggestions from the network. Can be scoped to org-only or network-of-orgs. |
| Settings | `open_settings(section?)` | Integrations, members, roles, confidence threshold, voice on/off, deletion. Single scrollable column, no tabs. |

### 4.3 Verbs (agent actions on the *current* room)

| Verb | Signature | Example |
|---|---|---|
| `highlight` | `(node_id \| element_id)` | Spotlights a node in Graph, fades others to 20% opacity. |
| `explain` | `(target, depth?)` | Drops an inline explanation card next to target, in plain English. |
| `compare` | `(a, b)` | Splits the content plane in half; used in Workflow or Stack. |
| `draft` | `(automation_spec)` | Opens a scratch card in Brief with a proposed recipe; user can approve, tweak via voice, or dismiss. |
| `defer` | `(card_id, reason)` | Moves a brief card to "not yet"; stores the reason in memory. |
| `confirm` | `(card_id)` | One-tap approve path for any card; emits deploy intent. |

### 4.4 Cards (transient, stackable overlays)

| Card kind | Trigger | Content |
|---|---|---|
| `memory` | Agent just wrote a memory | content, confidence, source chats, "expand" link |
| `entity` | Agent references an entity | name, aliases, integrations touched, last seen |
| `source` | "where did you hear this?" | chat excerpt with timestamp + integration chip |
| `diff` | Agent proposes a change | before/after of a workflow or prompt, approve/dismiss |
| `toast` | Deploy status | one-line ink message, auto-dismiss 3s |

Cards render bottom-right above the dock, stack max 3 visible, oldest slides out.

---

## 5. Surfaces — detailed frame list for Figma

Each surface becomes a frame in the Figma file. `*` = design for both empty and populated states.

### 5.1 Wake / Onboarding (first run)
- **Cold open**: paper surface, single breathing indigo dot, one line *"press and hold the dot, then tell me about your day"*. No buttons, no logo until scroll.
- **Integration connect** *: vertical list of integrations (Slack, GitHub, Linear, Gmail, Notion, Perplexity) with hairline rows, one-line status, connect via Composio CTA.
- **First overnight wait**: calm "sleep" screen with copy *"I'll read everything tonight. See you at 8am."* and a single moon glyph.

### 5.2 Brief room (hero)*
- Centered card stack (max 5 cards visible, rest counted as `+N more`).
- Each card, ~560×280px, hairline border, `paper/1`:
  - Confidence chip (high/med/low) top-left.
  - One-sentence plain-English title (e.g. *"Auto-triage Linear bugs from #product-bugs Slack channel"*).
  - 3-line "why" body — reads like prose, not specs.
  - Row of integration chips involved.
  - Footer: `Approve` (primary), `Show me how` (ghost — expands a recipe card inline), `Not yet` (text link).
- Secondary strip below the stack: **Yesterday's runs** — last 5 deployed automations with a tiny sparkline of triggers + a pass/fail dot.
- Ambient top-right: `3 workflows ran · 47 memories written · 2 new entities`.

### 5.3 Graph room*
- Force-directed canvas fills the content plane. Nodes sized by degree, coloured only by layer (integration / entity / memory / skill / workflow).
- Edges: `rule/hairline` at rest, `accent/indigo` when connected to a highlighted node.
- Labels: only on nodes with degree ≥ a threshold, to preserve calm.
- Left-floating filter palette (paper/1, hairline): layer toggles, time slider ("ingested in last 7 days"), integration pills.
- Hover: node pops into a mini-card with name + type + last-touched.
- Agent verb `highlight` spotlights a node; agent verb `explain` drops a memory card next to it.

### 5.4 Workflow room*
- Default: **recipe view** — ordered numbered steps, each step a one-liner in sentence case (*"When a new issue is created in Linear with label `bug`..."*).
- Integration chip gutter on the right, showing which tool each step touches.
- Toggle at top-right: `Recipe / DAG` — DAG view is a minimal node-edge diagram, still hairline-only.
- Footer row: `Confidence · Last run · Run count · Edit via waffle`.
- Verb `compare` splits the plane in half for A/B.

### 5.5 Stack room*
- Physical block metaphor. Each deployed microservice is a rectangular "shoji panel" — ~200×120px, stacks vertically or horizontally like LEGO/wooden blocks.
- Block content: service slug in mono, one-line purpose, runtime (Python version), last deploy timestamp, tiny health dot.
- Blocks snap together to imply composition; a workflow "owns" a column of stacked blocks.
- Drag a block → side drawer with logs (last 50 lines, mono), schedule, env, redeploy.
- Agent can `draft` a new block inline (appears with a dashed hairline border until approved).

### 5.6 Waffle room*
- Near-empty paper. Center prompt fades in.
- Press-and-hold voice dot (large, ~96px) triggers Deepgram stream. Release to stop.
- Transcript "sets in" below the dot in ink, line-by-line, then dissolves after ingest confirmation.
- Post-ingest toast card: *"Got it. I heard 3 things worth remembering."* — tap to see the 3 memory cards just written.

### 5.7 Playbook hub room* (enterprise)
- Three columns, hairline-separated:
  1. **Your org** — playbooks authored inside the org.
  2. **Curated network** — vetted shared playbooks across orgs (anonymised).
  3. **Suggested for you** — agent-picked playbooks based on your graph.
- Each playbook is a compact card: title, one-liner, integrations involved, adoption count, "try tonight" CTA (queues it for the overnight run, not auto-deploy).

### 5.8 Settings room*
- Single scrollable column, 720px max width. Sections separated by hairline + label, no tabs:
  - Integrations (reuse the onboarding list)
  - Members & roles (owner/admin/member, invite via email)
  - Org profile
  - Overnight schedule + confidence threshold
  - Voice (provider, barge-in on/off, voice persona)
  - Memory (export, delete scopes, retention)
  - Danger zone (wipe graph)

### 5.9 Shared components (design system page in Figma)
- Dock, voice dot states, card base, confidence chip, integration chip, hairline divider, approve button (primary / ghost / text), filter pill, toast, transcript line, microservice block, graph node/edge.

### 5.10 States matrix (small frames)
- Empty / loading / error / offline / agent-thinking / agent-speaking / deploy-in-flight / approval-success.

---

## 6. Voice + agent runtime architecture

### 6.1 Components
```
Browser (Next.js /web)
  └── Mic stream ──► Deepgram WS ──► STT transcript
                                       │
                                       ▼
                            Pydantic AI agent (server)
                            - tools: rooms, verbs, cards (§4)
                            - tools: SurrealDB reads/writes
                            - tools: Composio actions (existing)
                                       │
              ┌────────────────────────┴────────────────────────┐
              ▼                                                 ▼
       UI-tool emits                                  TTS text chunks
       (room/verb/card patch)                                 │
              │                                              ▼
              ▼                                       Cartesia/ElevenLabs
        SSE to browser                                      │
              │                                              ▼
              ▼                                         Audio stream
        Zustand UI store ◄──────────── Browser audio sink ◄─┘
```

### 6.2 Server contract
- `POST /api/agent/stream` (SSE): browser posts transcript chunks + current room + open cards; server streams back JSON events of three kinds:
  - `ui.room` → `{room, payload}`
  - `ui.verb` → `{verb, args}`
  - `ui.card` → `{kind, data, ttl?}`
  - `speak.chunk` → raw TTS text for Cartesia
- Agent runs as Pydantic AI with typed tool schemas exactly matching the vocabulary in §4.
- All writes to SurrealDB go through `MicrobotsDB` (already typed — see `@/Users/desmondzee/Coding/microbots/knowledge_graph/db/client.py`).

### 6.3 Latency budget (target)
- Mic → first STT token: <400ms.
- STT final → first UI patch: <600ms.
- STT final → first TTS audio chunk: <900ms.

### 6.4 Privacy posture
- Transcripts never persist by default unless the agent writes an explicit memory via the existing `knowledge_graph/enrich/writers/memory.py` path.
- A single kill switch in Settings → Voice disables all mic/TTS instantly.

---

## 7. Frontend — repo layout + stack

```
microbots/                         (existing git root)
├── knowledge_graph/               (existing — Desmond's backend)
├── agent/                         (existing — Jordan's harness)
└── web/                           (NEW — this plan)
    ├── app/
    │   ├── (shell)/               # layout with floating dock
    │   │   ├── brief/page.tsx
    │   │   ├── graph/page.tsx
    │   │   ├── workflow/[id]/page.tsx
    │   │   ├── stack/page.tsx
    │   │   ├── waffle/page.tsx
    │   │   ├── playbooks/page.tsx
    │   │   └── settings/page.tsx
    │   └── api/
    │       ├── agent/stream/route.ts   # SSE bridge to Pydantic AI
    │       ├── deepgram/token/route.ts # ephemeral key mint
    │       └── tts/route.ts            # Cartesia proxy
    ├── components/
    │   ├── dock/
    │   ├── cards/
    │   ├── graph/                      # react-force-graph-2d wrapper
    │   ├── recipe/
    │   ├── stack-blocks/
    │   └── primitives/                 # restyled shadcn
    ├── lib/
    │   ├── agent-client.ts             # SSE + tool-call router
    │   ├── voice.ts                    # Deepgram + Cartesia hooks
    │   └── store.ts                    # Zustand: current room, cards, voice state
    ├── styles/
    │   └── tokens.css                  # paper/ink/accent tokens from §3
    ├── tailwind.config.ts
    └── package.json
```

Key libraries: `next@15`, `react@19`, `tailwindcss@4`, `@radix-ui/*` via shadcn (heavily restyled to MUJI), `zustand`, `react-force-graph-2d`, `@deepgram/sdk`, `@cartesia/cartesia-js`, `eventsource-parser` for SSE, `framer-motion` (motion only, no flashy presets).

---

## 8. Org + roles + playbook hub (scoped)

- New SurrealDB tables (additive; will be specced in a follow-up DB plan, not touched here):
  - `org` (id, name, created_at)
  - `membership` edge: `user_profile → org` with `role ∈ {owner, admin, member}`
  - `playbook` (id, org?, scope ∈ {private, org, network}, title, description, recipe_json, adoption_count)
- Roles in v1:
  - **owner**: all settings, invite/remove members, delete org.
  - **admin**: invite members, edit org playbooks, manage integrations.
  - **member**: personal graph + brief + consume org playbooks.
- Graph overlay: when logged into an org, the Graph room shows a `You / Org` toggle; org view merges member graphs with entity dedup.
- Network scope for playbooks is read-only in v1 (no publishing UI yet) — curated by us manually for the MVP.

---

## 9. Figma deliverable plan

### 9.1 File creation
- Single design file: **`microbots — UI scope v1`** in `ifactorial` team (`team::1624218988842288042`).
- Paired FigJam board: **`microbots — navigation flows`** same team.

### 9.2 Design file page structure
1. **Cover** — product one-liner, palette swatches, type scale, one screenshot of the Brief room.
2. **Foundations** — color tokens (§3.1), type scale (§3.2), grid/spacing (§3.3), motion notes (§3.4).
3. **Components** — dock, cards, chips, blocks, graph node/edge, buttons, transcript line, toasts (all in both rest + hover + active + disabled).
4. **Shell & Dock** — full-viewport shell with dock in all five states (idle, listening, thinking, speaking, hidden).
5. **Onboarding** — cold open, integration connect, first overnight wait.
6. **Brief room** — hero card stack, yesterday's runs, empty state, 3-card / 8-card stack variants.
7. **Graph room** — filter palette, empty graph, sparse graph (50 nodes), dense graph (500 nodes), highlighted + explain card.
8. **Workflow room** — recipe view, DAG toggle, compare split.
9. **Stack room** — 1 service, 5 services, microservice drawer with logs.
10. **Waffle room** — idle, listening, transcript setting in, post-ingest toast.
11. **Playbook hub** — three columns, populated + empty.
12. **Settings** — all sections stacked.
13. **States matrix** — empty/loading/error/offline/thinking/speaking/deploying/approval-success.
14. **Enterprise** — org graph overlay, member list, role edit modal.

### 9.3 FigJam board content
- Node-edge diagram of the agent's **tool vocabulary**: user input → agent → {room, verb, card} → UI state.
- State machine of the dock (idle → listening → thinking → speaking → hidden).
- Sequence diagram: "morning brief → one-tap approve → deploy" end to end, including which Python service gets written.
- Sequence diagram: "waffle → STT → memory write → confirmation" with SurrealDB tables touched.
- Overnight chron pipeline: existing `knowledge_graph/enrich/*` → new automation-proposer agent → brief cards materialised.

---

## 10. Delivery phases (sequenced, read-only during plan mode)

Each phase is a hard gate; the next phase only begins on explicit user go-ahead.

1. **Phase 0 — plan sign-off.** (this doc) Nothing created yet.
2. **Phase 1 — Figma scaffolding.** Create design file + FigJam in `ifactorial`. Build Foundations page (tokens, type, grid). Build Components page (dock, card base, chips, block, graph primitives). Commit screenshots into this plan as addenda.
3. **Phase 2 — Hero frames in Figma.** Brief room + Graph room + Waffle room fully designed, including states matrix entries for each. Review with you.
4. **Phase 3 — Remaining rooms in Figma.** Workflow, Stack, Playbook hub, Settings, Onboarding. FigJam flows finalised.
5. **Phase 4 — Frontend scaffold.** `/web` Next.js 15 app, Tailwind tokens matching Figma, shell + dock only, no logic. Deployed to Vercel preview.
6. **Phase 5 — Agent bridge.** `/api/agent/stream` SSE, Pydantic AI tool vocab stubs, Zustand store, a mocked agent that emits the vocabulary on a fake timer to drive UI dev.
7. **Phase 6 — Voice loop.** Deepgram STT + Cartesia TTS wired end to end, waffle room live against a dev SurrealDB.
8. **Phase 7 — Data wiring.** Graph room reads real `MicrobotsDB`; Brief room reads from a new overnight-proposer stub; Workflow + Stack rooms render real workflows + microservices from the graph.
9. **Phase 8 — Orgs + playbook hub.** Additive DB schema, roles, overlay graph, hub room populated from a hand-curated seed.

Out of this plan's scope (separate future plans): the overnight proposer agent itself; the microservice deploy runtime; the org-graph dedup merger.

---

## 11. Risks / open questions (explicit, small)

- **Graph performance at 500+ nodes** — `react-force-graph-2d` is fine to ~2k; beyond, we'd swap to `sigma.js` + WebGL. Will validate in Phase 2 with seeded data.
- **Dock auto-hide UX** — may frustrate discoverability during onboarding; mitigated by a 2s on-first-load hint.
- **Voice barge-in** — Deepgram + Cartesia both support it, but our SSE bridge needs careful ordering so the agent stops speaking when STT detects new user audio. Will be tested in Phase 6.
- **"No chat history" promise** — requires trustworthy memory writes; we lean on the existing `knowledge_graph/enrich/writers/memory.py` pipeline. If a user asks "what did I say yesterday", the Brief room's `show_card(kind='source')` path is the answer, not a transcript.
- **One-tap approve blast radius** — every approved automation should start in a reversible state (dry-run for the first scheduled cycle, then promote). Flagged for the deploy runtime plan.

---

## 12. Explicit non-goals for v1

- Billing, payments, plan tiers.
- Mobile app, responsive below 1024px.
- Public playbook marketplace (network scope is read-only curated).
- Non-Python microservice runtimes.
- Fine-grained RBAC beyond owner/admin/member.
- In-product chat transcript history.
- Dark mode (may add later; light-only keeps the aesthetic disciplined for v1).

---

## 13. What happens on approval of this plan

On `exitplanmode`, the first concrete actions will be (in order, each a separate, confirmable step):

1. Create `microbots — UI scope v1` Figma design file in `ifactorial`.
2. Create paired FigJam board `microbots — navigation flows`.
3. Build Foundations and Components pages in the design file using §3 tokens.
4. Check both URLs back into this plan as an addendum.

No code in `/web` or elsewhere gets written until you've signed off Phases 1–3 (Figma) and explicitly say "start the frontend."

---

## Addendum — Phase 1, 4, 5, 6 implementation log

The user approved the plan and instructed implementation to proceed without further confirmation, so Phases 1 + 4 + 5 + 6 were executed together.

### Figma artefacts (in `ifactorial`, `team::1624218988842288042`)

- **Design file** — `microbots — UI scope v1`
  https://www.figma.com/design/G7ULuFMgaelVDwvpECNpR9
  (blank canvas; Foundations + Components pages will be built up from screenshots of the running `/web` app, since the Figma MCP exposes only blank-file creation, not programmatic frame layout)

- **FigJam navigation flows** (each generated separately by the MCP — paired-board promise was relaxed because `generate_diagram` creates one file per call)
  - Agent tool vocabulary — https://www.figma.com/board/RycEMjuoz7YJwFEHUAe3ZQ
  - Floating dock state machine — https://www.figma.com/board/e8dqul2ptBXxfHfOT90gCd
  - Morning brief approve flow — https://www.figma.com/board/mFnWDq53wXh0WGJiieYgzH
  - Waffle → memory sequence — https://www.figma.com/board/woTuzGe1GCsDZMnFDsR8Qs
  - Overnight ingest + proposer pipeline — https://www.figma.com/board/TOba3e9xnr5GMsxCV5BI6c

### `/web` Next.js 15 scaffold (live)

- Installed and booted at http://localhost:3000.
- All 8 routes return HTTP 200: `/` (307→`/brief`), `/brief`, `/graph`, `/workflow`, `/workflow/[id]`, `/stack`, `/waffle`, `/playbooks`, `/settings`.
- SSE agent stream verified — `POST /api/agent/stream` emits the full mocked event timeline (`agent.status` → `dock.thinking` → `ui.card.toast` → `agent.status` → `dock.speaking` → `ui.card.memory` → `dock.idle`).
- Voice + TTS routes (`/api/deepgram/token`, `/api/tts`) return 501 with friendly errors when keys are absent; UI stays silent.
- `tsc --noEmit` clean. Mock-agent flag (`NEXT_PUBLIC_MOCK_AGENT=true`) is on by default.

### What's intentionally not done in this addendum

- **Figma design frames** — the MCP only creates blank design files; real frames will be drafted by hand or by importing screenshots of the live `/web` rooms. Recommend a follow-up session where we open the design file together and lay out Foundations/Components/Hero rooms.
- **Real Pydantic AI agent** + SurrealDB read paths into the rooms (Phase 7 of the plan).
- **Org/role schema + playbook hub data** (Phase 8 of the plan) — UI is rendered from hand-written constants for now.
- **Dry-run / shadow-deploy runtime** for approved automations (separate plan).

### Quick start

```bash
cd web
cp .env.example .env.local
npm install
npm run dev    # http://localhost:3000
```

### Repo footprint added

- `/web/` — Next.js 15 App Router, ~25 files. `app/(shell)/{brief,graph,workflow,stack,waffle,playbooks,settings}` rooms; `components/{dock,cards,graph,recipe,stack-blocks,primitives,agent}`; `lib/{store,agent-client,mock-agent,voice,cn}`; `app/api/{agent/stream,deepgram/token,tts}`.

No edits were made anywhere else in the repo (`knowledge_graph/`, `agent/`, root `Makefile` and `pyproject.toml` are untouched).
