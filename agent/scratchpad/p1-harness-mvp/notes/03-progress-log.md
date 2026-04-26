# 03 — Progress log

Chronological diary so a fresh agent can pick up cold. Latest at top.

## 2026-04-26 ~07:00 UTC — merged jordan/p2-v1-tools (4→8 tools)

**Merged in** (commit `faf66a1`, no file conflicts — fully additive):
- 4 new MCP tools: `view_workflow`, `run_workflow`, `list_workflows`, `search_memory`
- `save_workflow` hardened: `overwrite=False` default, 64-char slug cap, 1MB code-size cap
- 41 unit tests at `agent/harness/mcp/tests/`
- e2e Playwright at `agent/harness/tests/e2e/`
- p2 scratchpad at `agent/scratchpad/p2-v1-tools/`

**Cloud redeploy auto-triggered**: deploy `dep-d7mrdvvaqgkc73fqrp10` live at 06:58:55 UTC. MCP server now exposes 8 tools.

**Smoke-tested through deployed prod chain:**
- `list_workflows` → `{workflows: [], count: 0}` (cloud disk is ephemeral; saved/ is empty after redeploy)
- `view_workflow("daily-greet")` → `{error: "workflow not found"}` (same root cause)
- Agent narrated both gracefully — no crash, no error to user

**Quirk worth knowing:** the cloud MCP's `saved/` directory is on the container's ephemeral filesystem. Every redeploy wipes user-saved workflows. For the demo we either:
1. Pre-seed `saved/` in the repo before deploy (commit example workflows)
2. Move `saved/` to a persistent volume (Render Disk, $1/mo)
3. Move to S3/R2/Postgres
4. Accept it for v0 demo and re-save during the demo session

Updated `notes/05-tool-schemas.md` for friend's UI mocking with the new 4 tools (now 8 total).

---

## 2026-04-26 ~06:21 UTC — M2 deploy half done

**Deployed:**
- **Frontend** → `https://microbot-harness-frontend.onrender.com` (Render Web Service, srv-d7mqr98k1i2s7399m9g0, Node 18, free plan)
- **MCP server** → `https://microbot-harness-mcp.onrender.com` (Render Web Service, srv-d7mms067r5hc7389r31g, Python, free plan, redeployed to pick up regenerated MCP_API_TOKEN)
- **Workflows** → `microbots` (already deployed during M1, no changes)

**End-to-end production smoke**: `curl POST /api/chat "compute square of 7"` → 12.3s round trip → "49" returned. Full chain: deployed frontend → deployed MCP (SSE+bearer) → cloud Workflows → result back.

**`render.yaml` declares both services with proper env-var wiring** (MCP_URL hard-coded, MCP_API_TOKEN via fromService.envVarKey, ANTHROPIC_API_KEY sync:false). Frontend service was created via Render REST API directly (not Blueprint sync) because Blueprint sync errored after cleanup. Auto-deploy on push still works (`autoDeploy: yes` on the service).

**Cleanup done in this session:**
- Deleted dup MCP service `microbot-harness-mcp-atlt` (srv-d7mqc6vlk1mc73dpd4i0).
- Deleted dup Blueprint Instance "microbot-harness-frontend" (exs-d7mqblreo5us73eujoa0). Both via DELETE /v1/services and DELETE /v1/blueprints — render CLI doesn't expose delete.
- Set RENDER_API_KEY env var on deployed MCP via API (so MCP can reach Workflows API).
- MCP_API_TOKEN regenerated on env-var PUT (Render quirk: `generateValue:true` keys regenerate on update). Frontend's token was set to match, then MCP redeployed to pick up the new value.

**Issues + fixes:**
- Render Blueprint Instance flow: the name you type in the UI labels the *Instance*, NOT the service. Service names come from yaml `services[].name`. Naming a new Instance "microbot-harness-frontend" while yaml only had MCP led to a duplicate MCP with `-atlt` suffix.
- Render API service-creation: 500 internal error when payload includes `runtime` field; works with `env` field instead. Plan `starter` worked previously but `free` works too.
- MCP env-var update via PUT regenerates `generateValue:true` keys. Sequence to keep tokens in sync: PUT MCP env vars → grab new MCP_API_TOKEN → PUT frontend env vars with that token → trigger MCP redeploy so the running process actually picks up the new token.
- Blueprint sync errors after cleanup. Worked around by creating frontend service via REST API. The Blueprint can be reconciled later (re-trigger sync from Dashboard or yaml change).

**M2 Done = NOT YET.** Deploy is done. Still pending:
- Polish: tool-call streaming UX, error states, loading skeletons.
- Playwright run against production URL (currently still tests local).
- Optional: bump plans from free → Starter to avoid spin-down (~15min idle = ~30s cold start). $7/mo each.
- Optional: reconcile Blueprint ownership of the frontend.

---

## 2026-04-26 ~05:55 UTC — M1 plumbing done

**Built:**
- `agent/harness/workflows/main.py` — replaced `run_user_code` stub with real exec(): captures stdout/stderr, runs optional `main(args)` entry point, returns `{result, stdout, stderr, error}`. Bundled httpx/requests/beautifulsoup4 in Workflows image.
- `agent/harness/mcp/server.py` — added 4 tools (`run_code`, `find_examples`, `save_workflow`, `ask_user`). `run_code` calls Render Workflows via `start_task` + polling (avoids `run_task` SSE hang inside asyncio). `ask_user` is server-declared but client-resolved. Switched transport from Streamable HTTP to **SSE** for compatibility with Vercel AI SDK MCP client.
- `agent/harness/mcp/templates/index.json` — copy of frontend templates seeded for MCP-side `find_examples`.
- `agent/harness/mcp/requirements.txt` — added `render_sdk>=0.6.0`.
- `agent/harness/frontend/app/api/chat/route.ts` — replaced inline tool defs with `experimental_createMCPClient` connection over SSE+bearer. Tools fetched dynamically from MCP. `ask_user` overridden as a no-execute tool() so AI SDK treats it as client-resolved.
- `agent/harness/frontend/.env.local` — added `MCP_URL` and `MCP_API_TOKEN`.
- `agent/scratchpad/p1-harness-mvp/tests/playwright.config.ts` — bumped per-test timeout to 180s for Workflows latency.
- All 5 spec files — bumped per-assertion timeouts from 30/45s → 90s.
- `v1-save-workflow.spec.ts` — fixed SAVED_DIR to point at `harness/mcp/saved/` instead of `harness/frontend/saved/` (the file now lives on the MCP server).

**Verified end-to-end:**
- Curl `/api/chat` "compute square of 7" → tools served from MCP → run_code hits Workflows → 49 returned in ~10s.
- All 5 Playwright tests green in 49.5s through full MCP+Workflows plumbing.
- Adversarial agent + evaluator agent verification: see latest notes.

**Architecture (M1 shape):**
```
Browser → Next.js /api/chat (local) → MCP server (local SSE :8765, bearer)
       → MCP run_code → Render Workflows /task-runs (cloud)
       → Workflows runner exec() → result back through MCP → through chat → browser
```

**Issues + fixes during M1:**
- `render_sdk.run_task` hangs forever when called from inside an asyncio event loop (it long-polls SSE, blocks the loop). Fixed by switching to `start_task` + sync polling of `get_task_run`, wrapped in `asyncio.to_thread`.
- Vercel AI SDK MCP client only supports SSE transport (not Streamable HTTP). Switched FastMCP server to `mcp.sse_app()`.
- Port 8000 occupied by Docker (SurrealDB). Used 8765 for MCP locally.
- Stale `.next` after `npm run build` then `npm run dev` causes 404 on static chunks. Fix: `rm -rf .next` + clean restart.

**Run from cold:**
```bash
# Terminal 1: MCP server
cd agent/harness/mcp
RENDER_API_KEY=$(grep RENDER_API_KEY ../../.env | cut -d= -f2) \
  MCP_API_TOKEN=dev-token-local PORT=8765 \
  .venv/bin/python server.py

# Terminal 2: frontend
cd agent/harness/frontend
npm install   # first time only
npm run dev

# Terminal 3: tests
cd agent/scratchpad/p1-harness-mvp/tests
npx playwright test
```

**M1 Done = ✅** Evaluator returned CONTRACT FULFILLED (8/8 criteria, with adversarial 5/5 in parallel). Milestone table in `02-v0-v1-contract.md` flipped to ✅. Commit `3fe16cc`.

---

## 2026-04-26 ~05:30 UTC — M0 (v0+v1 lean local) done

**Built (one autonomous session):**
- `agent/harness/frontend/app/api/chat/route.ts` — Next.js POST handler with Anthropic Sonnet 4.6 (via `@ai-sdk/anthropic`), 4 tools defined inline, streamText + maxSteps:8.
- `agent/harness/frontend/app/page.tsx` — chat UI using `@ai-sdk/react` `useChat`, renders text + tool-invocation badges + inline `ask_user` prompt.
- `agent/harness/frontend/templates/index.json` — 3 seed templates (hello-world, fetch-and-count-words, slack-ping).
- `agent/harness/frontend/saved/` — runtime output dir for `save_workflow` (empty before first run).
- `agent/scratchpad/p1-harness-mvp/tests/` — Playwright project (`package.json`, `playwright.config.ts`).
- `agent/scratchpad/p1-harness-mvp/tests/playwright/v0-smoke.spec.ts` — passes in 3.3s.
- `agent/scratchpad/p1-harness-mvp/tests/playwright/v1-{find-examples,save-workflow,ask-user,multistep}.spec.ts` — all pass, total 28.2s.
- `notes/02-v0-v1-contract.md` — Done definition.
- `plan/02-spec.md` + `plan/03-handoff.md` — prepended v0/v1-status block; preserved the deeper v2 design as reference.

**Verified:**
- All 5 Playwright tests green in 28.2s on cold dev server.
- Adversarial sub-agent: 5/5 user scenarios PASS (math factorial, fetch+count, template lookup, destructive-action gate, ambiguous request).
- API smoke: `curl POST /api/chat` returns valid Vercel AI SDK data stream.

**Tech choices:**
- Anthropic Sonnet 4.6 (Opus 4.7 errors with `temperature deprecated`; switch to Opus and set `temperature:1` if you want more capability).
- `ai` 4.3.19 + `@ai-sdk/anthropic` 1.2.12 + `@ai-sdk/react` 1.2.12.
- `subprocess.spawn("python3", ["-c", code])` with 30s timeout for `run_code`. Python 3.14 from Homebrew.
- No MCP server in v0 (kept deployed but unused). Tools defined inline in /api/chat.

**Issues encountered + fixed:**
- Initial smoke failed: `temperature is deprecated for this model` on Opus 4.7 → swapped to Sonnet 4.6.
- All 5 tests failed first run: dev server's static chunks 404 after `npm run build` left stale `.next/`. Fix: `rm -rf .next && npm run dev` clean restart.
- Adversarial agent flagged `httpx` not in system Python — rewrote `fetch-and-count-words` template to use `urllib.request` (stdlib only).

**Not done (deferred to v2):**
- `save_workflow` actually deploying to Render (mock URL only).
- Render Workflows fan-out / swarm pattern (the "fanning"). Pitch narrative ready in `agent/scratchpad/pitch/render.md`.
- MCP server connection from frontend (the deployed `microbot-harness-mcp` is unused by v0).
- Knowledge graph (Desmond's track).
- Multi-user, auth, persistence.
- Production Render deploy of the frontend (only Workflows is deployed; MCP web service and frontend still local-only).

**To run from cold:**

```bash
cd agent/harness/frontend
npm install
cp /path/to/anthropic_key .env.local  # ANTHROPIC_API_KEY=sk-ant-...
npm run dev   # http://localhost:3000

# In another shell:
cd agent/scratchpad/p1-harness-mvp/tests
npm install
npx playwright install chromium
npx playwright test
```

**Where the canonical docs live:**
- Done criteria: `notes/02-v0-v1-contract.md`
- This log: `notes/03-progress-log.md`
- Cold-start measurements: `notes/00-render-workflows-cold-start.md`
- Setup gotchas: `notes/01-setup-prereqs.md`
- Pitch story: `agent/scratchpad/pitch/render.md` + `agent/scratchpad/pitch/microbots-fractal.md`
- Original v2+ spec: `plan/02-spec.md` (with v0/v1-status block at top)
