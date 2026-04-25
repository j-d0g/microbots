> **Snapshot status (overnight ralph loop):** Implementation plan written before the team locked the actual hackathon schedule (24h, not weekend) and before Desmond's `knowledge_graph/` work landed on main. The day-by-day shape and many specific tasks are stale.
>
> **Concepts still load-bearing:** critical-path identification (kernel before any dependency-heavy build), four-tier ownership split, verification-gate-per-task discipline, demo dress rehearsal + failure-mode drills, the F4 kernel as first move.
>
> **Concepts stale:** specific file paths (`scaffold/`, `schema/04_v0_additions.surql`), assumed Friday→Sunday window, Devin promotion as critical-path (downgraded post-mission-reframe), Render Web Service per workflow (likely cron-job-with-mission-config instead).
>
> **Recommend:** rewrite as `agent/PLAN.md` for the actual 24h window after the mission-config reframe lands.

# microbots — MVP Implementation Plan

**Authors:** Claude (overnight ralph loop) — for review by Jordan, Desmond, Artem
**Date:** 2026-04-25
**Status:** Draft v1
**Companion docs:** [skimple.md](skimple.md), [design-v1.md](design-v1.md)

> Bounded, ordered tasks for Friday → Sunday. Each task has an owner suggestion, dependencies, time estimate, and a verification gate. Mark tasks complete only when the gate passes — not when the work feels finished.

---

## Day-by-day shape

| Day | Theme | Outcome |
|---|---|---|
| **Friday morning** | Env + scaffold + agent skeleton | `make` works for everyone; agent answers "hello" |
| **Friday afternoon** | Composio + iframe + first integration | Connect Gmail; agent reads inbox; iframe shows graph |
| **Friday evening** | Heartbeat + Mubit + Logfire | One end-to-end consolidation run; dashboards working |
| **Saturday morning** | IoA + bench harness | Playbook layer queried; bench numbers logged |
| **Saturday afternoon** | Devin promotion + polish | Hybrid demo working; UI cleaned up |
| **Saturday evening** | Demo dress rehearsal | Full 3-min demo run twice |
| **Sunday morning** | Pitch deck + contingencies | Slides done; fallbacks tested |
| **Sunday afternoon** | Pitch | 🥇 |

## Pre-flight (before Friday work begins)

These unblock everyone — do them first thing Friday morning.

### P1 — Drop credentials
- **Owner:** Jordan
- **Time:** 10 min
- **Action:** Edit `microbots/.env.local`:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  COMPOSIO_API_KEY=...
  LOGFIRE_TOKEN=...
  RENDER_API_KEY=...
  DEVIN_API_KEY=... (optional v0)
  MUBIT_API_KEY=... (optional v0)
  ```
- **Gate:** all keys present, none committed (`.env.local` is gitignored)

### P2 — Sponsor account signups
- **Owner:** anyone
- **Time:** 15 min total
- **Action:**
  - Composio dashboard: create Auth Configs for Gmail, Slack, Linear (3 toolkits)
  - Logfire: project + token
  - Render: ensure Starter tier billing on
  - Mubit: alpha access if not already
- **Gate:** keys flow into `.env.local`

### P3 — Resume the worktree branch
- **Owner:** Jordan
- **Time:** 5 min
- **Action:**
  ```bash
  cd /Users/jordantran/Agemo/microbots
  git fetch
  git checkout research/2026-04-25-overnight  # the overnight branch
  cat /Users/jordantran/Agemo/agent-workspace/skimple.md  # read first
  ```
- **Gate:** branch checked out; SKIMPLE read

---

## Friday morning (4h, ~9am-1pm)

### F1 — Boot the existing scaffold
- **Owner:** anyone
- **Time:** 20 min
- **Depends:** P1
- **Action:** `make db-up && make db-schema && make db-seed`
- **Gate:** `make db-query` opens shell; `SELECT * FROM user_profile;` returns 1 row

### F2 — Add v0 schema additions
- **Owner:** Desmond
- **Time:** 20 min
- **Action:** Apply `schema/04_v0_additions.surql` (in `scaffold/`) to add `_consolidator_runs`, `workflow.pending/deployed/confidence/render_service_url/github_repo`, `user_profile.api_keys`
- **Gate:** `INFO FOR TABLE workflow;` shows new fields

### F3 — Scaffold FastAPI app
- **Owner:** Jordan
- **Time:** 60 min
- **Depends:** F1
- **Action:** Stand up `apps/api/main.py` from `scaffold/agent/main.py.template`. Wire `logfire.configure` + `instrument_fastapi`. Add `/healthz`. Run `uv run uvicorn apps.api.main:app --reload`.
- **Gate:** `curl localhost:8000/healthz` → 200; Logfire dashboard shows the request

### F4 — Agent loop minimal walking skeleton
- **Owner:** Jordan
- **Time:** 90 min
- **Depends:** F3
- **Action:** Implement pydantic-ai `Agent` per `scaffold/agent/loop.py`. Wire `read_layer` + `search_hybrid` + `write_memory` against the existing schema. Skip Composio for now.
- **Gate:** `pytest tests/test_agent_smoke.py` — agent answers "what does the user use Slack for?" using only `read_layer(integrations.slack)`

### F5 — Iframe mockup live
- **Owner:** Artem
- **Time:** 90 min
- **Depends:** F1
- **Action:** Stand up `scaffold/web/index.html` as a static page on a separate Render Web Service (or local dev server). Open WS to SurrealDB, `db.live(new Table('memory'))`, render nodes via Cytoscape.
- **Gate:** Manually `CREATE memory:test ...;` in `make db-query` shell → node appears in iframe within 500ms

---

## Friday afternoon (4h, 2-6pm)

### F6 — Composio MCP wiring
- **Owner:** Jordan
- **Time:** 60 min
- **Depends:** F4, P2
- **Action:** `pip install composio` + `composio[pydantic-ai]` (or wire `MCPServerStreamableHTTP` directly). On agent init: `composio.create(user_id, toolkits=['gmail'])` → grab `mcp.url` → register as tool source. Test agent can list Gmail messages.
- **Gate:** `pytest tests/test_composio.py` — agent answers "how many unread emails?" via Composio

### F7 — Onboarding flow
- **Owner:** Artem
- **Time:** 90 min
- **Depends:** F3
- **Action:** `/onboarding` route + 3-step UI:
  1. Paste Anthropic key → validate → encrypt → store
  2. Connect Gmail/Slack/Linear via Composio `connected_accounts.initiate` → callback URL
  3. Launch chat
- **Gate:** Playwright test: paste valid key → connect Gmail → land on chat. Paste invalid key → red error.

### F8 — Chat UI with SSE
- **Owner:** Artem
- **Time:** 90 min
- **Depends:** F4
- **Action:** Use pydantic-ai's `VercelAIAdapter.dispatch_request` for `/chat/stream`. Vanilla JS frontend with `EventSource`. Render text + `html_card` outputs.
- **Gate:** Type "hi" in chat → streamed response appears word-by-word

### F9 — Live graph subscription wired to chat
- **Owner:** Artem + Jordan pair
- **Time:** 60 min
- **Depends:** F4, F5, F8
- **Action:** When agent calls `write_memory`, the live query pushes update → iframe upserts node visibly. Chat panel + graph iframe in same page (parent + iframe via postMessage for JWT).
- **Gate:** Chat: "remember that Alice is the infra contact" → memory node appears in graph in real time

---

## Friday evening (4h, 7-11pm)

### F10 — Heartbeat consolidator skeleton
- **Owner:** Desmond
- **Time:** 90 min
- **Depends:** F1, F4
- **Action:** Build `apps/heartbeat/main.py` per design §7.3 + `scaffold/agent/heartbeat.py`. Borrow ralph-loop shape (Stop-hook style, max-iterations safety, `_consolidator_runs` state). Cluster via `search_hybrid` on new chats since last run. Emit `workflow` with `pending=true`.
- **Gate:** Local manual run: `python -m apps.heartbeat --user_id=user:desmond` after seeding 5 mock similar chats → 1 workflow candidate emitted; `_consolidator_runs` row written

### F11 — Mubit wrapper
- **Owner:** Jordan
- **Time:** 60 min
- **Depends:** F4
- **Action:** Wrap pydantic-ai's underlying `AsyncAnthropic` client per design §10. Confirm Mubit alpha SDK actually accepts the wrapped client (smoke test via Mubit dashboard).
- **Gate:** Run agent twice on same task; second run shows Mubit-injected lessons in Logfire trace

### F12 — Render Blueprint
- **Owner:** Jordan
- **Time:** 60 min
- **Depends:** F3, F10
- **Action:** Write `render.yaml` with:
  - `web` service (the agent app)
  - `cron` job (heartbeat, every 6h or as configured)
  - `pserv` (private SurrealDB if self-hosting) OR external Surreal Cloud
  - `envVarGroups` for shared secrets
- **Gate:** `render blueprint launch --dry-run` succeeds; one real deploy reaches production

### F13 — Morning brief endpoint
- **Owner:** Desmond
- **Time:** 30 min
- **Depends:** F10
- **Action:** GET `/morning-brief` returns the top N pending workflow candidates as HTML cards. Client renders them in chat as agent-initiated message.
- **Gate:** Manual: trigger heartbeat → call endpoint → see card

---

## Saturday morning (4h, 9am-1pm)

### S1 — IoA playbook namespace
- **Owner:** Desmond
- **Time:** 90 min
- **Depends:** F12
- **Action:** Stand up `microbots_playbooks` namespace + schema (`schema/playbook_*.surql`). Distillation script that reads accepted workflows from user namespaces, strips private data, writes to playbook ns.
- **Gate:** Run distillation manually with 2 user namespaces' workflows → playbook rows appear

### S2 — Onboarding RAGs the playbook graph
- **Owner:** Desmond
- **Time:** 60 min
- **Depends:** S1, F7
- **Action:** After connect-3-toolkits step, query playbooks where toolkit overlap ≥ 50% → render top 3 as adoptable cards. Adoption = clone playbook into user's `workflow` ns as pending.
- **Gate:** Sign up Demo-Founder → see Desmond's distilled "Gmail-to-Linear-triage" playbook offered → click adopt → workflow row created

### S3 — Bench harness
- **Owner:** Desmond (in parallel with S1/S2 if Jordan takes it)
- **Time:** 120 min
- **Depends:** F4 (agent works)
- **Action:** Adapt Jordan's existing CodeWords bench. Five tasks (route, blogs, flats, flights, person research). Run microbots, Claude raw, Perplexity raw. Score per task.
- **Gate:** `bench/results.md` with per-task scores; visual chart for pitch

---

## Saturday afternoon (4h, 2-6pm)

### S4 — Devin promotion path (recorded + live theater)
- **Owner:** Jordan
- **Time:** 120 min
- **Depends:** F4, F12
- **Action:**
  - Spec template that combines candidate description + SurrealQL schema as Knowledge + Composio tool list + PEP-723 server.py template
  - On Accept: `POST /v3/organizations/{org}/sessions` with spec + repo URL
  - In parallel: pre-recorded happy path video starts playing in iframe
  - Watch for live PR via Devin webhook; on success swap recorded → live within 30s
  - Canned PR + GitHub repo as final fallback
- **Gate:** Manual: click Accept on a workflow card → recorded video plays → live Devin session starts (visible URL) → PR URL surfaces (live or canned) → Render API call succeeds

### S5 — Render-API-driven service deploy
- **Owner:** Jordan
- **Time:** 60 min
- **Depends:** S4
- **Action:** When PR merges (or canned PR provided), backend calls `POST /v1/services` with the new repo. Stores `render_service_url` in workflow row. Live query updates iframe with deployed status.
- **Gate:** End-to-end: Accept candidate → Devin (or canned) PR → Render service exists → `GET service_url/healthz` → 200

### S6 — Polish UI + onboarding copy
- **Owner:** Artem
- **Time:** 120 min
- **Depends:** F7, F8, F9
- **Action:** Apply visual polish to the iframe graph (color by node type, hover tooltips, node count badge). Onboarding copy reviewed for founder voice. Microbots wordmark + landing page line.
- **Gate:** Subjective — Jordan + Desmond agree it looks demo-ready

---

## Saturday evening (4h, 7-11pm)

### S7 — Demo dress rehearsal × 2
- **Owner:** all
- **Time:** 90 min total (45 min × 2 runs)
- **Depends:** F1-F13, S1-S6
- **Action:** Run the full 5-beat demo end-to-end with one teammate playing Demo-Founder. Time it. Note every breakage. Fix. Repeat.
- **Gate:** Two consecutive clean 3-minute runs with no manual intervention

### S8 — Failure mode drills
- **Owner:** all
- **Time:** 60 min
- **Action:** Practice each contingency from design §11.2 — kill Composio, kill Devin live, kill Render, kill Anthropic. Verify fallbacks engage cleanly.
- **Gate:** Each failure mode produces a graceful demo moment, not a stop

### S9 — Pre-stage demo data
- **Owner:** Jordan
- **Time:** 60 min
- **Action:** Seed Demo-Founder account with 7 days of synthetic Gmail/Slack data weighted to repeat the Gmail→Linear pattern 3-4 times. Pre-train Mubit. Pre-record Devin happy path.
- **Gate:** Cold reset of Demo-Founder + 1 demo run produces the expected morning brief card

---

## Sunday morning (3h, 9am-12pm)

### Su1 — Pitch deck
- **Owner:** Desmond + Jordan
- **Time:** 90 min
- **Depends:** S3 (bench numbers)
- **Action:** 6-8 slides:
  1. Cover — "microbots: the empire assembles itself while you sleep"
  2. The pain (founder's tool fragmentation, repetitive flows)
  3. The product (one screenshot of the iframe graph mid-action)
  4. The architecture (this design's component map, simplified)
  5. The IoA reveal (the "your microbots talk to their microbots" line)
  6. Bench numbers vs Claude/Perplexity
  7. Sponsor map (every sponsor's role in the architecture)
  8. Roadmap / ask
- **Gate:** Slides on a tablet, ready

### Su2 — Demo final dry run
- **Owner:** all
- **Time:** 45 min
- **Action:** Full clean run with audience timing. Identify single demo lead.
- **Gate:** Sub-3-minute clean run

### Su3 — Talk to sponsors at booths
- **Owner:** Jordan + Desmond
- **Time:** 45 min
- **Action:** Visit each sponsor booth, share what we built, gather feedback, build rapport with judges
- **Gate:** Spoken with at least 4 sponsors (per Jordan's prior hackathon learnings — wins follow rapport)

---

## Sunday afternoon

### Su4 — Pitch
- **Owner:** Demo lead + Q&A backup
- **Time:** 5 min slot
- **Action:** Walk the 5-beat demo + 3-slide IoA reveal. Field questions.
- **Gate:** 🥇

---

## Owner workload summary

| Owner | Estimated total |
|---|---|
| Jordan | ~14h (agent loop + Composio + Devin + bench shadow) |
| Desmond | ~10h (heartbeat + IoA + bench) |
| Artem | ~9h (iframe + onboarding + UI polish) |
| Shared | ~4h (rehearsals, sponsor talks) |

Friday + Saturday + Sunday morning ≈ 28 hours engineer-time across 3 people. Tight but achievable given how much foundation already exists.

## Critical path

`F1 → F3 → F4 → F6 → F9 → S4 → S7`

If F4 (agent loop walking skeleton) slips past Friday afternoon, S4 (Devin promotion) is at serious risk. F4 is the priority unblock.

## Definition of done

A run is "demo-ready" when:
- [ ] Cold-reset Demo-Founder onboarding flow works end-to-end
- [ ] Three integrations connect via Composio
- [ ] Chat answers from graph (no live integration call) in <3s
- [ ] Live iframe shows graph updating during chat
- [ ] Heartbeat triggers and produces a candidate card
- [ ] Accepting candidate produces a deployed Render service (live or canned)
- [ ] Mubit lessons visible across runs
- [ ] Logfire dashboard captures the entire trace
- [ ] IoA reveal shows borrowed playbook on a second user's onboarding
- [ ] Two consecutive clean 3-minute demo runs

If any item fails, the demo plan in design §11.2 covers contingency.
