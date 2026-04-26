# 03 — Handoff

For the next agent, no prior context.

---

## ⚠️ v0 / v1 are DONE — start here

**Active source of truth:** `../notes/02-v0-v1-contract.md` (Done criteria, what's built, how to verify).

**Status (2026-04-26):** v0 + v1 complete. 5 Playwright tests + adversarial sub-agent (5/5 pass) verify the chat loop end-to-end. Implementation at `agent/harness/frontend/`. Reverse path:

```
1. cd agent/harness/frontend && npm install && npm run dev
2. cd agent/scratchpad/p1-harness-mvp/tests && npx playwright test
3. Open http://localhost:3000 — chat with the agent
```

**For v2 work** (Render Workflows fan-out / swarm demo): see `../sponsors/`-style docs at `agent/scratchpad/pitch/render.md` + `agent/scratchpad/pitch/microbots-fractal.md`. The original spec/handoff below is the v2+ aspirational design.

---

## Where you are

- Repo: `microbots`
- Branch: `jordan/microbot_harness_v0`
- Worktree: `microbots/agent/.worktrees/jordan-microbot_harness_v0/`
- Scratchpad: `agent/scratchpad/p1-harness-mvp/` ← this file is in `plan/`
- Implementation goes in: `agent/harness/`

`agent/scratchpad/p0-braindump-notes/` contains an **earlier and superseded** design (DESIGN-v1, PLAN-v1, BRAINDUMP, etc.). **Do not follow them.** They describe a different product (SurrealDB + iframe + multi-user auth).

## Read order

1. `02-spec.md` — what to build
2. This file — verification + ground rules
3. `01-findings.md` — only if you doubt a decision

## Point of contact

If you need to verify a claim about the original upstream codebase, get further context, or escalate a deviation: ask the **orchestrator** (Jordan, or the planning Claude session). Do NOT try to obtain or copy from upstream — IP belongs to Jordan's employer; we are clean-room rebuilding.

---

## External services + secrets

- **Render** — GitHub OAuth, paid plan needed for the always-on MCP service (~$7/mo Starter; Jordan has $50 credit).
- **Anthropic API key** (or Vercel AI Gateway key).
- **Composio API key** — https://app.composio.dev. Pre-auth Slack/Gmail/Linear before Phase 3.
- **Postgres** — Render-managed via Blueprint.
- *(optional)* Logfire token if you lift `microbots/log.py`.
- *(NOT needed for P1)* Docker creds — only used by `microbots/render_sdk/`, which we are not lifting (see `01-findings.md` §microbots reuse).

Keys live in `agent/.env` (worktree-local), **not** the repo-root `microbots/.env` (that one is Desmond's knowledge-graph track).

**Before any phase work, complete the prerequisite checklist in `../notes/01-setup-prereqs.md`** — covers `render login` (device code, not API key), the easy-to-miss `render workspace set` step, and the verification commands. A fresh agent that skips this will fail mid-Phase-0 with "no workspace set".

Ask Jordan or self-provision missing keys.

---

## Quickstart for the next agent

If you've never seen this codebase: do these steps in order. Stop at each verification gate.

```
1. Read 02-spec.md §"Architecture" (5 min, it's a diagram + 5-tool table)
2. Run setup-prereqs from ../notes/01-setup-prereqs.md
3. Scaffold Phase 0 (see Run instructions below)
4. Verify Phase 0 gates pass
5. Pick the next phase from the spec, build, verify
6. Repeat
```

If you're an agent orchestrator (not the implementer): set up an agent team — single long-lived `microbot-harness` team, Opus lead + 3 named Sonnet teammates (`infra`, `tools`, `frontend`). One team. If a teammate is blocked, spawn a one-off verifier in the same team.

---

## Phase verification gates

Each must pass before moving to the next. Failure = stop, debug, or escalate.

### Phase 0 — scaffold deployed

```bash
# 1. MCP server health
curl -fsSL https://<mcp-svc>.onrender.com/health
# Expected: {"status":"ok"}

# 2. Frontend reachable
curl -fsSL https://<web-svc>.onrender.com
# Expected: 200, returns HTML

# 3. Workflows cold start
python -c "
import asyncio, time
from render_sdk import RenderAsync
client = RenderAsync()
async def main():
    t = time.time()
    run = await client.workflows.start_task('<workflows-svc>/noop_task', {})
    res = await run
    print(f'cold start + run took {time.time()-t:.2f}s, result={res}')
asyncio.run(main())
"
# Expected: <10s, returns 'ok'
# RECORD the timing in notes/00-render-workflows-cold-start.md
```

**If cold start >5s consistently: HARD STOP.** Write timing in `notes/decisions-changed.md` and escalate. The scratch-task pattern depends on fast cold starts; consider keep-alive ping or smaller container image.

Add tests in `tests/phase-0/` automating the above. At minimum: bash + Python script.

### Phase 1 — static loop works

Run an MCP Inspector (or script) against the deployed MCP server with the bearer token. Verify:

```
- 5 tools listed (consult_docs, search_templates, run_code, Ask_User_A_Question, Set_Behavior_Mode)
  (run_code may be a stub at this phase)
- consult_docs(["how-to-write-a-workflow.md"]) returns the seed doc content
- search_templates("slack") returns the seed Slack template
```

Browser test (manual): open the deployed frontend, type "what tools do you have access to?". The LLM should reply with content grounded in the seed docs.

`tests/phase-1/`: a Python script that lists MCP tools via the MCP client SDK; optional Playwright test.

### Phase 2 — code execution end-to-end

Browser test:

```
User: "compute 5 squared please"
Expected:
  - LLM responds within ~3s
  - LLM calls run_code with appropriate Python
  - Result `25` returns within ~15s total
  - LLM replies "5 squared is 25" or similar
```

Multi-step:

```
User: "fetch https://example.com and count the words"
Expected:
  - LLM does step 1 (fetch), runs it
  - LLM does step 2 (count), runs it on the fetched content
  - Replies with the word count
  - Total time < 30s
```

`tests/phase-2/`: integration test that calls the deployed MCP `run_code` with simple Python.

### Phase 3 — Composio integration

Pre-condition: a real Slack workspace connected to Composio with a test channel.

```
User: "send a message to #my-test-channel saying hello from the mvp"
Expected:
  - LLM calls Ask_User_A_Question to confirm BEFORE sending
  - User confirms
  - LLM generates code using composio.actions.execute(...)
  - Slack message appears in the channel within ~10s
```

`tests/phase-3/`: integration test against a *test* Slack workspace.

### Phase 4 — demo-ready

- 90-second demo video: a single fluid task end-to-end without dead air >15s per step.
- Frontend has acceptable typography + loading states.
- Repo is in a state another developer could deploy fresh in <30 minutes.

---

## Run instructions (for a human or agent)

### Local dev

```bash
# Terminal 1: MCP server
cd agent/harness/mcp_server
pip install -e .
export MCP_API_TOKEN="dev-token-anything-works"
export DATABASE_URL="postgresql://localhost/microbot_harness_dev"
export RENDER_API_KEY="..."  # for run_code; can stub in Phase 0
uvicorn server:app --reload --port 8080

# Terminal 2: Frontend
cd agent/harness/web
pnpm install
export ANTHROPIC_API_KEY="..."
export MCP_SERVER_URL="http://localhost:8080/mcp"
export MCP_API_TOKEN="dev-token-anything-works"
export DATABASE_URL="postgresql://localhost/microbot_harness_dev"
pnpm dev   # http://localhost:3000

# Terminal 3 (optional): Postgres in Docker
docker run -d --name pg -p 5432:5432 \
  -e POSTGRES_DB=microbot_harness_dev \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16
psql postgresql://localhost/microbot_harness_dev -f migrations/0001_init.sql

# Terminal 4 (Phase 2+): Workflows local dev
# https://render.com/docs/workflows-local-development
cd agent/harness/workflows
pip install -e .
render workflows dev -- python tasks.py
```

If Render Workflows local dev is awkward, run `run_code` against the *deployed* workflows service even from local — also fine.

### Deployed (Render)

Push to `jordan/microbot_harness_v0`. Render rebuilds + redeploys both web services. The workflows service redeploys when its `tasks.py` or deps change.

```bash
git push origin jordan/microbot_harness_v0
# Watch Render dashboard for build status
```

### Smoke test

```bash
./tests/smoke.sh   # health checks + a single chat round-trip
```

Write `tests/smoke.sh` in Phase 0; refine each phase.

---

## Decision log

D1–D7 with one-line reasons. Full justifications in `01-findings.md`.

| # | Decision | Reason | Reversible? |
|---|---|---|---|
| D1 | Render Workflows + scratch-task for `run_code` | Avoids 1–5 min per-edit deploy dead air | Yes — could swap to Web-Service-exec if Workflows unavailable |
| D2 | Single-user demo, no auth | Hackathon scope | Yes — JWT bolt-on is straightforward |
| D3 | Minimal Next.js + Vercel AI SDK | Matches upstream reference shape, ~100 LOC for chat UI | Yes — vanilla HTML acceptable fallback |
| D4 | 5-tool MCP surface | Verified upstream agent minimum | No — these are load-bearing |
| D5 | Composio for integrations | Team preference; OAuth + tool discovery handled | Yes — direct SDKs work too |
| D6 | Postgres for state, no SurrealDB | Simpler; SurrealDB is Desmond's separate track | Yes — but adds complexity |
| D7 | Build via Claude Code agent teams | Single team: Opus lead + `infra` + `tools` + `frontend` Sonnets | Yes — solo build also fine |

---

## Deviation rules

**Free to change:** tool internals, DB schema, frontend framework, test framework, module structure, file names, system-prompt wording, pre-bundled libs list.

**Must log in `notes/decisions-changed.md` (with reason):** dropping/adding an MCP tool, swapping execution substrate (Workflows → something else), reaching for a new external service, skipping a phase gate.

**Must get Jordan's signoff:** spending money beyond hackathon credits, pushing to a branch other than `jordan/microbot_harness_v0`, touching `microbots/knowledge_graph/` or `microbots/render_sdk/` (other team members' tracks), merging to `main`, public demo posts.

---

## Out of P1 scope (defer)

- **Save-as-workflow** (Phase 4+ if time). Add `edit_service` + `deploy_service` MCP tools so users can promote a successful chat run into a named, persistent Workflow task.
- **Knowledge graph integration** (Desmond's track). Connect `microbots/knowledge_graph/` so the agent can `consult_docs` against per-user behavior facts.
- **Multi-user auth.** Per-user JWT + row-level scoping. Bearer-auth foundation already in place.
- **Real-time webhook triggers.** Small Render Web Service relay receives Slack/Gmail webhooks, triggers Workflow runs.
- **Render Web Service per-workflow deploy** (Daud's `microbots/render_sdk/` covers it post-MVP). Stable URLs per workflow.
- **iframe artifact UI.** v1 plan, separate frontend track.
- **Devin-promotion theater for the demo.** v1 plan demo angle.
- **The upstream agent Modes / `launch_sub_agent`.** Unmerged in upstream.

---

## Sanity check

If your answers don't match these, re-read `01-findings.md` before starting:

- **Q: What is P1's success metric?**
  A: A judge can submit a real ad-hoc multi-step coding task in chat and see real output in <30 seconds.

- **Q: Where does user code execute?**
  A: One Render Workflows task (`<workflows-svc>/run_user_code`) that exec()s arbitrary Python.

- **Q: How many MCP tools are essential?**
  A: 5. (Or 4 if you collapse `Set_Behavior_Mode` into a single default mode.)

- **Q: Are we lifting `microbots/render_sdk/`?**
  A: No. Naming collision with the PyPI Workflows SDK; targets the wrong primitive (Web Service deploys).

- **Q: What's the worktree?**
  A: `microbots/agent/.worktrees/jordan-microbot_harness_v0/`. Branch: `jordan/microbot_harness_v0`.

- **Q: What's the first thing to measure in Phase 0?**
  A: Render Workflows cold-start latency. Record in `notes/00-render-workflows-cold-start.md`. If consistently >5s: HARD STOP.

- **Q: What's in `agent/scratchpad/p0-braindump-notes/`?**
  A: A superseded plan (DESIGN-v1, PLAN-v1, BRAINDUMP, etc.). Ignore it.

If anything here surprises you: read `01-findings.md` for the evidence trail.

---

**End of handoff.** You have everything. Build it.
