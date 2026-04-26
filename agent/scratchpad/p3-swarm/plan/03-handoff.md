# 03 — Handoff

For the next agent or future-Jordan picking this up cold. Read order: this → `02-spec.md` → `01-findings.md`.

---

## Where you are

- Repo: `microbots`
- Branch: `jordan/microbot_harness_v0` (worktree at `agent/.worktrees/jordan-microbot_harness_v0/`)
- Active scratchpad: `agent/scratchpad/p3-swarm/`
- Implementation lives under `agent/harness/{frontend, mcp, workflows}/`. Don't put code in `scratchpad/`.

The harness already runs end-to-end on Render: frontend (Next.js) → MCP server (FastMCP, 8 tools) → Workflows (`run_user_code` etc.). This phase makes the agent *use* parallelism well; it does not change deploy shape, tool count, or schemas.

---

## External services + secrets needed

- **Render** — already provisioned. Workflows service `microbots`, MCP at `microbot-harness-mcp`, frontend at `microbot-harness-frontend`. Concurrency is the lever (Hobby = 20 free, +5 chunks ~$1/mo).
- **Anthropic API key** — already in the frontend env on Render.
- **No new keys.** Pattern A is just bundled-deps + asyncio. Pattern B is just the existing tool-call infra.

---

## Phase verification gates

Each must pass before moving on. Failure = stop and write up findings, don't paper over.

### Phase 0 — Confirm assumptions
- A direct CLI trigger of `run_user_code` with a 10-URL `asyncio.gather` body returns `{result, stdout}` in <8 s wall clock and `len(result) == 10`.
- Vercel AI SDK with two simultaneous tool calls produces overlapping start timestamps in the streamed response (i.e. it isn't serialising).

### Phase 1 — Template + prompt
- Browser flow: "fetch these 5 URLs and tell me which is biggest" → assistant calls `find_examples` first, then exactly one `run_code`, returns the answer in <10 s end-to-end.
- The LLM does NOT issue 5 sequential `run_code` calls. If it does, the prompt nudge isn't strong enough — iterate, don't merge.

### Phase 2 — Benchmark + decision
- Three trials per pattern logged in `notes/02-bench-swarm.md` with raw numbers.
- A one-line verdict: which pattern goes in the demo, at what N, and why.

### Phase 3 — Demo polish (optional)
- Loading state visible during the ~6 s wait.
- One talking-points note covering the cost + isolation trade-off so the pitch is grounded in numbers.

---

## Decision log

| # | Decision | Reason |
|---|---|---|
| D1 | Pattern A (single task + internal asyncio) is the harness default | One cold-start, no parent-eviction, already supported |
| D2 | Pattern B (parallel `run_code` tool calls) is reserved for true-isolation cases | More expensive, more surface area, only worth it when isolation is the point |
| D3 | Pattern C (task awaits subtask) is forbidden | Empirically broken at chain-3 (~50 s) and unfixable from our side |
| D4 | No new MCP tools, no new substrate, no new services | Scope discipline — the swarm phase is a *behaviour* change, not a platform change |
| D5 | Concurrency upgrade is a runtime/billing setting, not a code change | Adjust in the Render dashboard if a demo needs N > base concurrency |

---

## Deviation rules

**Free to change without logging:** template names, the exact wording of the prompt nudge, the benchmark script's structure, file names within `p3-swarm/`.

**Must log in `notes/decisions-changed.md` (with reason):** adding a new MCP tool, swapping the execution substrate, introducing nested-await patterns, dropping a phase gate.

**Must get Jordan's signoff:** spending money beyond the existing Render concurrency settings, deploying changes that touch Desmond's `knowledge_graph/`, opening a PR to `main` from this branch.

---

## Out of scope (defer)

- save-as-real-Render-Web-Service for `save_workflow` (still mock URL).
- True multi-agent / sub-agent swarms (forking Claude contexts). We're doing parallelism at the *task* layer, not the *agent* layer.
- Per-tenant concurrency or rate-limiting. Single-user demo.
- Postgres for run history.
- Persistent benchmark dashboard.

---

## Sanity check

If your answers don't match these, re-read `01-findings.md` before starting.

- **What's the default parallelism pattern?** Pattern A: one `run_user_code` task with internal `asyncio.gather`.
- **When do we use Pattern B (parallel tool calls)?** Only when each item needs full isolation (e.g. untrusted code per input).
- **Are we touching the Workflows substrate or MCP tool count?** No.
- **What's the smoking-gun number from p1?** `chain_3(x=5)` median 48 s — proved task-awaits-task is dead.
