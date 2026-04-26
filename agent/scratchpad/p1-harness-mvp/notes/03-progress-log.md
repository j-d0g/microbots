# 03 — Progress log

Chronological diary so a fresh agent can pick up cold. Latest at top.

## 2026-04-26 ~05:30 UTC — v0 + v1 done

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
