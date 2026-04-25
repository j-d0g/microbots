> **Snapshot status (overnight ralph loop):** Decision log as of overnight completion. Architectural decisions made later (mission-config reframe, three execution modes, supersedes pattern, retention by type, four-quadrant deck, agent-as-runtime collapse) are not reflected here. Use this for the foundational consensus; subsequent decisions extend rather than replace.

# HANDOFF — overnight ralph loop

**Started:** 2026-04-25 ~00:30
**Branch:** `research/2026-04-25-overnight` (worktree at `/Users/jordantran/Agemo/agent-workspace`)
**Source repo:** `/Users/jordantran/Agemo/microbots` (untouched on `main`)

---

## Wake-up checklist

1. Read [SKIMPLE.md](SKIMPLE.md) — distilled overview, ~5 min
2. Skim this file (HANDOFF) — confirm decisions match what you'd have made
3. Read [docs/specs/2026-04-25-microbots-design.md](docs/specs/2026-04-25-microbots-design.md) — formal spec
4. Read [docs/plans/2026-04-25-mvp-implementation-plan.md](docs/plans/2026-04-25-mvp-implementation-plan.md) — Friday→Sunday tasks
5. If happy: `git checkout research/2026-04-25-overnight` from `microbots/`, divide tasks
6. If something needs revising: edit + tell me / next session

## Constraints honored tonight

- ✅ No git pushes
- ✅ No deploys
- ✅ No Agemo code copied (read-only architectural reference)
- ✅ No money spent (no live LLM calls, no Composio activations)
- ✅ `.env` not touched (your modifications preserved)

## Default decisions taken

| # | Decision | Why default | Where to revise |
|---|---|---|---|
| 1 | Demo task: morning-brief frame + Gmail-to-Linear copy-paste cluster as the promoted workflow | Most visible cluster pattern, cleanest Composio wiring (Gmail + Linear toolkits), strongest IoA fit | design doc §11 |
| 2 | Agemo IP boundary: read for patterns, clean-room rebuild | Safest re: employer IP — read-only references, zero copies | n/a |
| 3 | Stack: Python/FastAPI + pydantic-ai + SurrealDB + vanilla-JS iframe | Existing scaffold matches; pydantic-ai gives Logfire synergy; vanilla JS for iframe leanness | design doc §5 |
| 4 | Demo integrations: Gmail + Slack + Linear via Composio MCP | Zero-config pydantic-ai integration; founder-resonant; free tier 20k calls/mo | design doc §11 |
| 5 | Workflow primitive: PEP-723 `server.py` FastAPI per Render Web Service | Stolen verbatim from Agemo runtime pattern (R2 finding) | design doc §5.4, §7.5 |
| 6 | Multi-tenancy: row-level `owner` + table PERMISSIONS, not db-per-user | Live queries can't span databases — would break playbook layer | design doc §6.2 |
| 7 | Auth model: BYO API key (Anthropic) + per-user JWT (SurrealDB) | Anthropic banned 3rd-party OAuth (Feb 2026 ToS); paste + validate is fine | design doc §8 |
| 8 | Devin demo: hybrid (pre-record + live theater + canned PR fallback) | Pure-live too risky (67% success, 15-min ACUs); pure-recorded weak signal | design doc §11.2 |
| 9 | Render tier: Starter ($7/mo) | Free tier sleeps after 15 min — demo killer | impl plan P1 |
| 10 | Tie-breaker rule: pick reversible option, log here | Avoids silent unilateral commitments | this file |

## Reversals from earlier conversation thinking (logged for transparency)

These were settled tonight by research and contradict things I said earlier in our chat:

- **Anthropic OAuth split-usage demo** → KILLED. Anthropic explicitly banned 3rd-party agent frameworks from OAuth (Feb 2026 ToS). Pivot to BYO API key. (R7 + R10)
- **"Devin promotion live on stage"** → DOWNGRADED to hybrid demo. Cognition's own data shows Devin sessions can hang for hours. (R9)
- **"Render free tier"** → KILLED. Free tier sleeps after 15 min idle. Need Starter. (R10)
- **"Database per user might be cleanest for tenancy"** → KILLED. Live queries are single-database. Use row-level owner + PERMISSIONS. (R6)
- **"PI coding agent — which one?"** → IDENTIFIED. Mario Zechner's `pi-coding-agent`. Cite as inspiration, don't outsource. (R9)

## Files I created (all under `agent-workspace/`)

### Top-level navigation
- `SKIMPLE.md` (2364 words) — first read for the team
- `HANDOFF.md` — this file
- `PROGRESS.md` — running log of overnight activity
- `.gitignore` — Python / pytest / .env.local / .DS_Store

### Research notes (10 files, ~13.8k words total)
- `docs/research/agemo-agents.md` — agent + sub-agent + harness patterns from Agemo
- `docs/research/agemo-runtime-pattern.md` — workflow execution architecture (PEP-723 server.py contract)
- `docs/research/ralph-loop.md` — Geoffrey Huntley pattern, Stop-hook mechanism
- `docs/research/atomic-sdk.md` — flora131/atomic, why we don't use it
- `docs/research/kaig-martin.md` — Martin's SurrealDB-as-filesystem patterns
- `docs/research/surrealdb.md` — live queries, HNSW, hybrid search, multi-tenancy
- `docs/research/pydantic-stack.md` — pydantic-ai v1.86.1 + Logfire setup
- `docs/research/composio.md` — multi-user OAuth, MCP integration with pydantic-ai
- `docs/research/coding-agents-external.md` — Devin + PI disambiguation
- `docs/research/sponsor-glue.md` — Mubit, Render, Anthropic OAuth findings

### Specs and plans
- `docs/specs/2026-04-25-microbots-design.md` (3370 words) — formal design doc
- `docs/plans/2026-04-25-mvp-implementation-plan.md` — Friday→Sunday task list with verification gates

### Scaffold (verifiable contracts, no live deps)
- `scaffold/agent/contracts.py` — 5 Pydantic models, validated by 20-test pytest suite
- `scaffold/agent/system_prompt.md` — skinny ~300-token template
- `scaffold/agent/loop.py` — `build_agent()` factory + 5 native tool stubs (requires pydantic-ai when implemented)
- `scaffold/agent/heartbeat.py` — `HeartbeatConfig`, `RunResult`, `run_heartbeat()` signature
- `scaffold/web/index.html` — three-column iframe shell (chat / graph / cards)
- `scaffold/web/graph.js` — SurrealDB live-query stub, `node --check` clean
- `scaffold/web/chat.js` — SSE consumer skeleton, `node --check` clean
- `scaffold/tools/composio_adapter.py` — `make_composio_mcp_tools()` stub + `RECONNECT_TOOL_NAME` constant
- `scaffold/tools/native_tools.py` — pydantic-ai tool stubs (requires pydantic-ai when implemented)
- `scaffold/README.md` — guide to scaffold structure

### Schema migration (additive, idempotent)
- `schema/04_v0_additions.surql` — `_consolidator_runs` + `workflow.pending/deployed/confidence/...` + `user_profile.api_keys`

### Config
- `render.yaml` — Render Blueprint with `web` + `cron` services and `envVarGroup`
- `pyproject.toml` — added pydantic + pytest dev group; commented future deps (pydantic-ai, logfire, fastapi, composio)
- `tests/conftest.py` + `tests/test_contracts.py` — 20-test pytest suite, all passing

## Files I deliberately did NOT touch

- `/Users/jordantran/Agemo/microbots/.env` — your modified env, off-limits
- `/Users/jordantran/Agemo/microbots/` source checkout (worktree on a separate branch)
- `/Users/jordantran/Agemo/agemo/` — read-only architectural reference
- `/Users/jordantran/Agemo/agemo-pre-ralph-loop/` — read-only diff target
- Any other top-level Agemo directory

## Verification status

- ✅ pytest scaffold: **20/20 tests pass** (`uv run pytest`)
- ✅ Python contract imports: clean (`scaffold.agent.contracts`, `scaffold.agent.heartbeat`, `scaffold.tools.composio_adapter`)
- ✅ JS files parse: `node --check` clean on `graph.js` and `chat.js`
- ⚠️ `scaffold.agent.loop` and `scaffold.tools.native_tools` need pydantic-ai when implemented (deferred dep, commented in pyproject.toml)
- ⚠️ Schema additions (`04_v0_additions.surql`) not applied yet — Friday F2 task

## Open questions for you (priority order Friday morning)

1. **Demo task lock** — confirm Gmail-to-Linear copy-paste cluster, or swap. *Affects:* Composio toolkit selection (currently Gmail + Slack + Linear), seed data tweaks. *5-min decision.*
2. **Hybrid Devin commitment** — pre-record + live theater + canned fallback is solid but ~2h setup. Confirm. *If we drop Devin, the promotion beat becomes "microbots writes the workflow itself, Render deploys" — still good but loses one sponsor visibility.*
3. **Render budget** — confirm we can spend ~$15 across 2-3 Starter services for the weekend.
4. **Anthropic API key drop** — `.env.local` (NOT `.env` since you modified that). ~$50 weekend budget covers comfortably.
5. **Composio account** — sign up at composio.dev, create one Auth Config per toolkit (Gmail, Slack, Linear). 5 min of clicks. Drop COMPOSIO_API_KEY in `.env.local`.
6. **Logfire** — sign up at logfire.pydantic.dev, drop token in `.env.local`. Free tier covers us.
7. **SurrealDB hosting** — local Docker for dev (already wired) is fine; for the live demo I lean Surreal Cloud (one less moving piece). Confirm or reject.

## Resume instructions for next session

When you wake up:

1. `cd /Users/jordantran/Agemo/microbots && git fetch && git checkout research/2026-04-25-overnight`
2. `cat /Users/jordantran/Agemo/agent-workspace/SKIMPLE.md` (or open in editor)
3. Skim this file
4. Read design doc + impl plan
5. Drop the credentials in `microbots/.env.local`
6. Run `make db-up && make db-schema && make db-seed` from the microbots directory to verify foundation still works
7. Begin F1-F5 from the implementation plan with the team

If you decide the design needs revision before any implementation:
- Edit the design doc
- Re-run focused research with a sub-agent on the area you changed
- I (or the next Claude session) can iterate from there

If you're happy:
- Begin Friday F1 from the implementation plan
- Critical path is `F1 → F3 → F4 → F6 → F9 → S4 → S7` — guard F4

## Commit info

This worktree was committed as one commit on `research/2026-04-25-overnight` containing all overnight artifacts. Source `microbots/` checkout (`main` branch) is untouched. To merge into your main work:

```bash
cd /Users/jordantran/Agemo/microbots
git fetch
git log research/2026-04-25-overnight --oneline  # confirm commit
git merge --no-ff research/2026-04-25-overnight  # or cherry-pick what you want
```

Or just keep the branch parallel and reference files via the worktree at `/Users/jordantran/Agemo/agent-workspace/`.
