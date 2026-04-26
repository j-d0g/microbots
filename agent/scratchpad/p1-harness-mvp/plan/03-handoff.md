# 03 — Handoff

For the next agent, no prior context.

---

## Where you are

- Repo: `microbots`
- Branch: `jordan/microbot_harness_v0`
- Worktree: `microbots/.worktrees/jordan-microbot_harness_v0/`
- Scratchpad: `agent/scratchpad/p1-harness-mvp/` ← this file is in `plan/`

`agent/DESIGN-v1.md`, `PLAN-v1.md` etc. are a **superseded** earlier direction. Ignore them.

## Read order
1. `02-spec.md` — what to build
2. This file — verification + ground rules
3. `01-findings.md` — only if you doubt a decision

---

## External services + secrets

- **Render** — GitHub OAuth, paid plan needed for the always-on MCP service (~$7/mo Starter)
- **Anthropic API key** (or Vercel AI Gateway key)
- **Composio API key** — https://app.composio.dev. Pre-auth Slack/Gmail/Linear before Phase 3.
- **Postgres** — Render-managed via Blueprint
- *(optional)* Logfire token if you lift `microbots/log.py`

Ask Jordan or self-provision.

---

## Phase verification gates

Each must pass before moving to the next. Failure = stop, debug, or escalate.

### Phase 0
```
curl https://<mcp-svc>.onrender.com/health        → 200 {"status":"ok"}
MCP Inspector connects with bearer, lists tools   → ping visible + callable
SDK trigger of noop_task                          → record cold-start in notes/
```
**If cold start >5s consistently: HARD STOP.** Write up the timing and escalate. The scratch-task pattern depends on fast cold starts.

### Phase 1
LLM connects to deployed MCP, calls `consult_docs(["how-to-write-a-workflow.md"])`, gets content. Browser chat returns grounded text.

### Phase 2
Browser: "compute 5 squared" → 25 in <15s end-to-end.
Browser: "fetch a URL and count words" → correct count, two `run_code` calls, <30s total.

### Phase 3
Browser: "send a Slack message to #channel saying X" → real message in Slack within ~10s.

### Phase 4
90-second demo video, no dead air >15s per step.

Tests live in `tests/phase-N/` — write them as you go. `tests/smoke.sh` from Phase 0 onward.

---

## Decision log

D1–D7 with one-line reasons. Full justifications in `01-findings.md`.

| # | Decision | Reason |
|---|---|---|
| D1 | Render Workflows + scratch-task for `run_code` | Avoids 1–5 min per-edit deploy dead air |
| D2 | Single-user demo, no auth | Hackathon scope |
| D3 | Minimal Next.js + Vercel AI SDK | Matches the upstream stack reference shape, ~100 LOC for chat UI |
| D4 | 5-tool MCP surface | Verified the upstream agent minimum |
| D5 | Composio for integrations | Team preference; OAuth + tool discovery handled |
| D6 | Postgres for state, no SurrealDB | Simpler; SurrealDB is Desmond's separate track |
| D7 | Build via Claude Code agent teams | Single team: Opus lead + `infra` + `tools` + `frontend` Sonnets |

---

## Deviation rules

**Free to change:** tool internals, DB schema, frontend framework, test framework, module structure, file names, system-prompt wording, pre-bundled libs list.

**Must log in `notes/decisions-changed.md` (with reason):** dropping/adding an MCP tool, swapping execution substrate (Workflows → something else), reaching for a new external service, skipping a phase gate.

**Must get Jordan's signoff:** spending money beyond hackathon credits, pushing to a branch other than `jordan/microbot_harness_v0`, touching `microbots/knowledge_graph/` or `microbots/render_sdk/` (other team members' tracks), merging to `main`, public demo posts.

---

## Out of P1 scope (defer)

- save-as-workflow (Phase 4+ if time)
- knowledge graph integration (Desmond's track)
- multi-user auth
- real-time webhook triggers (needs relay Web Service)
- iframe artifact UI (v1 plan, separate track)
- Render Web-Service-per-workflow path (Daud's `render_sdk/` covers it post-P1)
- The upstream agent Modes / `launch_sub_agent`

---

## Sanity check

If your answers to these don't match, re-read `01-findings.md` before starting:

- **Where does user code execute?** One Render Workflows task (`run_user_code`) that exec()s arbitrary Python.
- **How many MCP tools?** 5 (or 4 if you collapse `Set_Behavior_Mode`).
- **Are we lifting `microbots/render_sdk/`?** No. Naming collision with the PyPI Workflows SDK; targets the wrong primitive.
- **What's the first thing to measure in Phase 0?** Render Workflows cold-start latency.
