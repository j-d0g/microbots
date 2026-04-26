# PROGRESS — overnight ralph loop

Running log of activity. Newest at top.

---

## 2026-04-25 — kickoff

- ✅ Created worktree at `<internal-workspace>` on branch `research/2026-04-25-overnight`
- ✅ Discovered existing microbots foundation (schema + seed + markdown layer system) — already committed at `dfc6018`
- ✅ Scaffolded directory structure: `docs/{research,specs,plans}`, `notes/`, `scaffold/{agent,web,tools}`
- ✅ Seeded skimple.md, handoff.md, progress.md
- 🔄 Dispatching 10 parallel research agents

## Sub-agents complete (all 10)

| ID | Topic | Output | Headline finding |
|----|-------|--------|------------------|
| R1 | agent + harness patterns | `../harness/agent-architecture.md` | the upstream agent's `consult_docs` ≅ microbots' `layer_index` graph (graph version stronger). Wire pydantic-ai to `read_layer(id)`. One dispatcher per provider, not N tools. |
| R2 | runtime pattern | `../harness/runtime-pattern.md` | Workflow = single PEP-723 `server.py` FastAPI. **Drop E2B+coordinator for promoted bots** → one Render Web Service per microbot, Render API for programmatic deploy. Steal `server.py` contract verbatim. |
| R3 | Ralph loop | `../harness/ralph-loop.md` | Geoffrey Huntley's `while true` re-feeding same prompt until `<promise>DONE</promise>`. Stop-hook driver + `.claude/ralph-loop.local.md` state. ~190 LOC bash. **Borrow scaffold, replace static prompt with templated reflect-replan for our consolidator.** |
| R4 | Atomic SDK | `../harness/atomic-sdk.md` | TS-only, wraps black-box CLIs via tmux. **Don't adopt.** Port concepts: frozen workflow graph, transcript-only stage hand-off, sub-agent role taxonomy. |
| R5 | Martin's kaig | `../harness/kaig-martin.md` | Flat `file` table + computed path. pydantic-ai `FunctionToolset` with cat/ls/edit/write/mkdir/retrieve. `db.live(Table('file'))` for UI sync. **Port tool shape verbatim. Our `layer_index` already richer than kaig's flat FS.** |
| R6 | SurrealDB | `../stack/surrealdb.md` | Live queries WS-only + single-node v2. HNSW + FTS + graph fused via `search::rrf()`. **Multi-tenancy: row-level `owner` + PERMISSIONS, NOT db-per-user** (breaks playbook layer). Browser auth via `DEFINE ACCESS RECORD` + short-lived JWT. URL must end `/rpc`. |
| R7 | Pydantic stack | `../stack/pydantic-stack.md` | pydantic-ai v1.86.1 (Apr 23, Opus 4.7 supported). **No native Anthropic OAuth.** Multi-agent: agent-as-tool with `usage=ctx.usage`. Logfire = 3 lines. `VercelAIAdapter.dispatch_request` = SSE for `useChat()`. |
| R8 | Composio | `../stack/composio.md` | **Composio handles multi-user OAuth in-product** (we call `connected_accounts.initiate`, get callback). pydantic-ai integration zero-config via Composio's first-party MCP. Free tier 20k calls/mo. Demo: Gmail+Slack+Linear. |
| R9 | Devin + PI | `../harness/coding-agents-external.md` | **PI = Mario Zechner's `pi`** (pi.dev / `@mariozechner/pi-coding-agent`). Cite as inspiration. **Devin demo = hybrid (pre-record happy path + parallel live session for theater + canned PR fallback).** Don't outsource harness. |
| R10 | Mubit/Render/OAuth | `../stack/sponsor-glue.md` | **Anthropic OAuth = banned for 3rd-party frameworks (Feb 2026 ToS).** Pivot to BYO API keys. Mubit: wrap underlying Anthropic client. Render Starter required (free sleeps after 15min). Render REST API enables programmatic service creation = promoted-microservice pattern. |

## Now: synthesizing skimple.md, writing design doc + impl plan + scaffold

## Phase 2: synthesis + scaffolding — complete

- ✅ skimple.md (2364 words) — top-of-mind distillation
- ✅ design-v1.md (3370 words) — formal spec, 15 sections
- ✅ plan-v1.md — Friday→Sunday, 22 ordered tasks, verification gates, critical path
- ✅ Scaffold sub-agent (S1) completed: 13 files (contracts.py, system_prompt.md, loop.py, heartbeat.py, index.html, graph.js, chat.js, composio_adapter.py, native_tools.py, schema/04_v0_additions.surql, render.yaml, tests/test_contracts.py, conftest.py, scaffold/README.md)
- ✅ Verification gates:
  - pytest 20/20 passing (after adding pydantic + pytest to pyproject.toml)
  - Python contract imports load cleanly
  - JS files parse via `node --check`
  - native_tools.py / loop.py require pydantic-ai (documented as deferred dep)
- ✅ .gitignore added
- ✅ handoff.md complete — every decision logged, every file manifested, every open question listed

## Final state

Worktree at `<internal-workspace>` on branch `research/2026-04-25-overnight`. Ready for commit. Source `microbots/` checkout untouched. Zero pushes, zero deploys, zero money spent.
