> **Snapshot status (overnight ralph loop):** Architectural decisions captured here are correct as a baseline. Decisions made *after* this doc — workflow=mission reframe, lifecycle live→consulting→rigid, supersedes/retention by memory_type, four-quadrant suggestion deck — are tracked elsewhere (chat / future HANDOFF entries) and will land in `agent/DESIGN.md` when reconciled. File paths reference the now-stale `research/2026-04-25-overnight` branch layout (`scaffold/`, `docs/specs/`, `schema/04_v0_additions.surql`) — translate against the current `agent/` + `knowledge_graph/` split.

# SKIMPLE — microbots overnight distillation

> The first thing you read. Liquid-gold findings from a night of research and scaffolding. If you only read one file, this is it.

**Status:** complete
**Branch:** `research/2026-04-25-overnight` (worktree at `/Users/jordantran/Agemo/agent-workspace`)
**Constraints honored:** no keys, no pushes, no deploys, no Agemo code copied

---

## TL;DR

microbots is further along than we thought — the SurrealDB schema is real and good. Tonight's work focused on filling the missing pieces: agent loop pattern, integration story, sponsor wiring, demo strategy. **All five sponsors fit naturally**, with two corrections to earlier thinking:

1. **Anthropic OAuth is dead for us** — banned by Anthropic for third-party agent frameworks (Feb 2026 ToS). Pivot to **BYO API key**, paste-and-validate onboarding. Frame as *"your key, your spend"* — actually a stronger pitch to founders.
2. **PI = Mario Zechner's `pi`** (`@mariozechner/pi-coding-agent`). Cite as inspiration; don't outsource the harness.

The 90-second pitch:

> *Founders connect Slack/Gmail/Linear/Notion via Composio in 30 seconds. microbots ingests their world overnight, builds a SurrealDB ontology graph (their "SaaS empire"), surfaces structure (workflow candidates emerge from clustered actions), and proposes — with code — automations they never got round to writing. Accept one, microbots scaffolds it as a Python microservice, deploys to Render, and runs it on schedule. Tomorrow morning the empire is bigger. The IoA layer means another founder's distilled playbooks reach you anonymously — same problem solved by 60 graphs ago.*

## Reversals from earlier thinking

| Topic | Earlier take | Tonight's finding | New take |
|---|---|---|---|
| Anthropic OAuth | "Bring your Claude" — split-usage demo | Anthropic explicitly banned 3rd-party agent frameworks from OAuth (Feb 2026 ToS) | **BYO API key only.** Paste + validate on onboarding. Encrypted storage in SurrealDB. |
| PI coding agent | "Which one do you mean?" | Identified: Mario Zechner's `pi` — TS terminal coding harness, RPC mode | Cite in README as kindred spirit. Optional RPC embed for narrow code-mod tasks. **Don't use as substrate.** |
| Devin demo | "Promote accepted suggestion live" | 67% PR merge rate, sessions can hang for hours, ACUs are 15-min chunks | **Hybrid demo:** pre-record happy path + parallel live session for theater + canned PR fallback. |
| Render hosting | "Free tier" | Free tier sleeps after 15 min — demo killer | **Starter tier ($7/mo)** required. |
| SurrealDB multi-tenancy | "DB per user maybe" | Live queries can't span databases — would break the playbook layer | **Row-level `owner` + table PERMISSIONS in one ns/db.** |
| Workflow primitive | "Python microservice in E2B" | Agemo runs them in E2B per-request from a coordinator | **Drop coordinator + E2B for promoted bots.** One Render Web Service per microbot, Render REST API for programmatic create. Keep E2B only for pre-promotion sandboxing. |

## Top 5 actionable findings

### 1. The existing schema *is* the moat — wire it to a `read_layer` tool

microbots' `layer_index` + `drills_into` + `indexed_by` graph pattern is functionally identical to Agemo's `consult_docs` filesystem-of-markdown — but **strictly better**: token budgets per layer, FTS + HNSW backing, polymorphic edges, live-query-able. The highest-ROI port from Agemo is wiring pydantic-ai to a `read_layer(layer_id)` tool that returns the budgeted markdown for that layer. The agent navigates the graph by drilling layers — not by stuffing all memory in context.

→ See `../harness/agemo-agents.md`

### 2. Composio + pydantic-ai = zero-config via MCP

Composio publishes a first-party MCP integration. One line: `composio.create(user_id, toolkits=[...]).mcp.url` → `MCPServerStreamableHTTP` plugged into pydantic-ai. **All Slack/Gmail/Linear/Notion/GitHub tools auto-register with full schemas.** Auth is in-product: we call `connected_accounts.initiate(user_id, auth_config_id, callback_url)` → Composio hosts the consent screen → we get a callback. **We never touch raw OAuth secrets.** Free tier = 20k calls/mo (plenty for hackathon).

→ See `../stack/composio.md`

### 3. Workflow primitive locked: PEP-723 `server.py` → Render Web Service per microbot

Agemo's workflow contract: a single Python file with `# /// script` PEP-723 deps header, a FastAPI app, typed Pydantic request/response models, structlog middleware. We **steal this contract verbatim**. When a founder accepts a proposed automation:
1. Devin (or our own LLM) drafts `server.py` in a new repo from a template
2. Agent calls Render REST API: `POST /v1/services` with that repo
3. Render auto-deploys
4. Agent registers it in SurrealDB as a `workflow:slug` node + `workflow_uses → integration` edges
5. Render Cron Job hooks the schedule

→ See `../harness/agemo-runtime-pattern.md`

### 4. Live-query iframe is the demo weapon

Browser opens WebSocket to SurrealDB (`/rpc`), authenticates with a short-lived JWT minted by our Python backend, calls `db.live(Table('memory'))` and `db.live(Table('layer_index'))`. **Every graph write the agent does pushes to the iframe in milliseconds.** New nodes pop into the visualization in real time. The demo: founder asks something → graph lights up live as the agent reads, writes, clusters. No polling, no manual refresh.

JS SDK shape:
```js
const live = await db.live(new Table("memory"), (action, result) => {
  // action: "CREATE" | "UPDATE" | "DELETE" | "CLOSE"
  graph.upsert(result);  // tweak D3/Cytoscape
});
```

**Limit to know:** SurrealDB live queries are single-node-only in v2 — fine for one Render service, but not for clustered SurrealDB. Cluster comes later.

→ See `../stack/surrealdb.md` and `../harness/kaig-martin.md`

### 5. Ralph loop pattern → overnight consolidator scaffold

Geoffrey Huntley's "Ralph Wiggum" technique (now a Claude plugin): a `while true` re-feeding the same prompt to Claude until it emits `<promise>DONE</promise>`, with a Stop-hook driver and a `.claude/<feature>.local.md` state file. **~190 LOC of bash.** We borrow the scaffold for the overnight consolidator (System 1) but replace the static prompt with a *templated reflect-and-replan* prompt that injects accumulated cluster state. Each iteration: read all chat/memory rows from the day, embed-cluster, propose new `workflow` candidates, write them as `pending=true`, exit when no new clusters surface for N iterations.

→ See `../harness/ralph-loop.md`

## What's already in the repo

The microbots checkout at `/Users/jordantran/Agemo/microbots` (commit `dfc6018`) has:

- ✅ SurrealDB v2 in `docker-compose.yml`
- ✅ Schema: `00_setup.surql`, `01_nodes.surql` (8 tables), `02_relations.surql` (16 relations including polymorphic), `03_indexes.surql` (HNSW + FTS), `apply.py`
- ✅ Seed: `seed/seed.py` populates Desmond's profile + 5 integrations + 10 entities + 5 chats + 6 memories + 4 skills + 3 workflows
- ✅ `memory/` markdown layer system: `user.md` root + per-layer `agents.md`
- ✅ Makefile lifecycle (`db-up`, `db-schema`, `db-seed`, `db-reset`, `db-query`, `db-export`)
- ✅ Python 3.11+, uv-managed, `pyproject.toml`
- ✅ `.env` (yours — untouched tonight) with SurrealDB creds
- ✅ `kaig/` (Martin's reference impl, untracked)

## What's still missing (build targets for the team)

In priority order for Friday team:

| # | Component | Owner suggestion | Verification gate |
|---|---|---|---|
| 1 | Agent loop (System 2 daytime) — pydantic-ai + Logfire + first 3 tools | Jordan | unit test: agent answers "what does Desmond use Slack for" using only `read_layer` |
| 2 | Composio MCP wiring + 3-toolkit demo (Gmail/Slack/Linear) | Jordan / Artem | playwright test: founder clicks "Connect Gmail", returns ✅ |
| 3 | iframe UI (chat + live graph view) | Artem | playwright test: insert memory row → node appears in iframe within 500ms |
| 4 | BYO-API-key onboarding flow | Artem | paste invalid key → red error; paste valid → ✅ + 1 test message |
| 5 | Heartbeat consolidator (System 1) skeleton on ralph-loop scaffold | Desmond | unit test: cluster 3 mock chats → emits 1 workflow candidate |
| 6 | Render Blueprint (`render.yaml`) | Jordan | `render blueprint launch` succeeds in dry-run |
| 7 | Mubit wrapper around pydantic-ai's Anthropic client | Jordan | log shows lessons-injected pre/post diff |
| 8 | IoA: playbook graph + cross-user distillation | Desmond (Saturday) | playwright: 2nd test user's onboarding shows 1 borrowed playbook |
| 9 | Devin promotion path (recorded + live theater) | Jordan (Saturday) | live session URL visible in iframe; canned PR fallback ready |
| 10 | Bench harness vs Claude / Perplexity on 5 founder tasks | Desmond (Saturday) | report.md with per-task scores |

## Stack — final

| Layer | Choice | Why |
|---|---|---|
| Language | Python 3.11+, async | existing |
| Agent framework | pydantic-ai v1.86.1 | Logfire synergy, multi-agent via agent-as-tool, escape hatches |
| Web | FastAPI | pydantic-ai integration; UI via `VercelAIAdapter.dispatch_request` for SSE |
| Memory DB | SurrealDB v2 (Docker locally / Surreal Cloud in prod) | graph + vector + FTS + live queries in one |
| Frontend | vanilla JS + SurrealDB JS SDK over WS for live | minimal, no build step needed |
| Integrations | Composio | hosted multi-user OAuth, MCP-native, 20k free calls/mo |
| LLM | Anthropic Claude Opus 4.7 (BYO API key) | pydantic-ai default, prompt caching |
| Sandbox | E2B (pre-promotion only) | per-request lifecycle for code exec before "promotion" |
| Deploy | Render | Web Services + Cron Jobs + REST API for programmatic deploy |
| Observability | Pydantic Logfire | 3-line setup, auto-instrument pydantic-ai + FastAPI |
| Execution memory | Mubit (alpha) | wrap pydantic-ai's underlying Anthropic client |
| External coding agent | Cognition Devin (hybrid demo only) | one beat: spec → PR for promoted workflow |
| Auth | BYO API key (paste + validate) for Anthropic + per-user JWT for SurrealDB | OAuth banned by Anthropic for our use case |

## Architecture in one paragraph

A FastAPI app hosts the agent loop and the chat UI. The agent loop is a pydantic-ai `Agent` instance, instrumented by Logfire, with two tool sources: (a) Composio MCP server (founder-scoped, auto-registers all connected toolkits) and (b) a small native toolset for SurrealDB navigation (`read_layer`, `traverse`, `write_memory`, `search_hybrid`, `propose_workflow`). The agent emits HTML cards as structured outputs that render in an iframe; the same iframe subscribes to SurrealDB live queries on `memory` and `layer_index` so the graph view updates in real time as the agent writes. A separate Render Cron Job runs the **heartbeat consolidator** every ~6h (System 1): it reads new `chat`/`memory` rows, clusters via embeddings + tags, and writes `workflow` candidates with `pending=true`. The morning brief renders these candidates as cards. When a founder accepts a candidate, the agent calls Devin's API with a spec template + the SurrealDB schema as Knowledge — Devin opens a PR — Render auto-deploys the new microservice as a fresh Render Web Service. The IoA layer (Saturday) is a second SurrealDB namespace `microbots_playbooks` containing distilled (privacy-stripped) workflow templates with edges back to user-graph anonymous IDs; new founders' onboarding RAGs the playbook graph for matches.

## Demo narrative — locked draft

**Setup (5s):** Three founders signed in (Desmond, Jordan, Demo-Founder). Iframe shows Demo-Founder's empty graph.

**Beat 1 — connect (15s):** Demo-Founder clicks "Connect Gmail / Slack / Linear". Composio hosted consent. Returns. Iframe graph populates with `integration` nodes.

**Beat 2 — System 2 chat (45s):** Demo-Founder: *"draft a reply to that investor email about ARR."* Agent calls `read_layer(integrations.gmail)` → finds the email → drafts. Graph lights up with new `chat`, `memory`, `entity:investor_x` nodes in real time.

**Beat 3 — System 1 reveal (45s):** Cut to overnight clip (or trigger heartbeat manually). Console: "consolidator running…" Graph rearranges as `workflow` nodes precipitate. Morning card appears: *"You did 3 inbox-→-Linear copies this week. I wrote the workflow. Approve?"*

**Beat 4 — promotion (30s):** Demo-Founder clicks Approve. Iframe shows Devin session URL ticking. Pre-recorded happy path: PR opened, Render deploys, new Web Service appears in graph as `workflow:gmail_to_linear_triage`. (If live Devin returns in time → swap to live PR. If not → canned fallback.)

**Beat 5 — IoA reveal (30s):** Switch to Jordan's account. Onboarding screen: *"3 playbooks already match your stack — based on Desmond's distilled patterns."* One-click adopt. Graph shows new edges `workflow → playbook` linking back to anonymous source.

**Closing (10s):** *"microbots: the empire assembles itself while you sleep."*

3 minutes. Every sponsor has a visible beat.

## Open questions for you (in priority order)

1. **Demo task lock** — I defaulted to morning-brief + support-ticket-triage. The demo narrative above uses Gmail-to-Linear copy-paste as the cluster pattern. Confirm or swap. *Affects:* Composio toolkit selection, seed data tweaks.
2. **Hybrid Devin commitment** — pre-record + live theater + canned fallback is a solid plan but takes ~2h to set up. Confirm budget. *If we drop Devin entirely, the promotion beat becomes "microbots writes the workflow itself, Render deploys" — still good but loses one sponsor visibility.*
3. **Render Starter ($7/mo)** — confirm we can spend ~$15 across 2-3 services for the weekend.
4. **Anthropic API key** — drop in `.env.local` when you wake up. ~$50 budget for the weekend covers us comfortably.
5. **Composio account** — sign up at composio.dev and create one Auth Config per toolkit (Gmail, Slack, Linear). 5 min of clicks.
6. **Logfire token** — sign up at logfire.pydantic.dev, drop token. Free tier covers us.
7. **Surreal Cloud OR self-hosted SurrealDB on Render?** — local Docker for dev is fine; for the live demo I lean Surreal Cloud (one less moving piece). Confirm.

## What I built tonight

- `skimple.md` (this file) — first read for the team
- `handoff.md` — every decision logged, every file touched
- `progress.md` — running log of overnight activity
- `*.md` — 10 research distillations (~13.8k words total). Read SKIMPLE first, drill into specific research file only if a topic concerns you.
- `design-v1.md` — formal design spec
- `plan-v1.md` — bounded ordered tasks for the team
- `scaffold/` — verifiable static scaffolding: agent loop interface contracts, iframe HTML mock, render.yaml, type definitions

**Untouched:** the source `microbots/` checkout, your `.env`, all of `agemo/`, Mubit credit, Render dollars, GitHub remote.

## Where to look next (priority order Friday morning)

1. **Read this file (you're here)**
2. Skim `handoff.md` — confirm my default decisions match what you'd have made
3. Read `design-v1.md` — the formal spec to reference all weekend
4. Read `plan-v1.md` — divide the work
5. Drop the 4 keys + sign up for Composio/Logfire (~10 min total)
6. Run `make db-up && make db-schema && make db-seed` to confirm DB still wakes up
7. Each teammate: pick top tasks from the plan, work on the shared worktree branch or their own
8. Drill into specific `*.md` only if you hit a question that file owns
