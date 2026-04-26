# 02 — v0 / v1 contract (Done definition)

**Owner:** this Claude session, autonomous execution. Sole agent.
**Started:** 2026-04-26 ~05:00 UTC

## Milestone log

| Milestone | Status | Verified by | Commit |
|---|---|---|---|
| **M0: lean local v0** — chat loop runs locally with inline tools + subprocess `run_code` | ✅ DONE 2026-04-26 ~05:30 UTC | 5 Playwright tests + adversarial 5/5 + evaluator CONTRACT FULFILLED | `f52fc78` |
| **M1: v0 plumbing** — MCP server hosts the 4 tools; `run_code` executes via Render Workflows; frontend `/api/chat` consumes tools from MCP | 🟡 IN PROGRESS | _Playwright tests must pass against MCP-backed + Workflows-backed loop_ | — |
| **M2: v1 tuning** — UX polish, error handling, frontend deploys to Render, end-to-end public URL works | ⏳ pending | _Playwright tests pass against deployed URL_ | — |
| **M3: v2 swarm** — recursive fan-out demo for Render prize (`pitch/render.md` + `pitch/microbots-fractal.md`) | ⏳ pending — out of scope until M1+M2 | _Live dashboard shows ≥50 parallel containers in 90s demo_ | — |

**Promise:** finish each milestone before declaring done. Verify with Playwright + adversarial sub-agent + evaluator sub-agent. Don't hand off mid-milestone.

## Out of scope (deferred to later milestones)

- Render Workflows recursive fan-out / swarm — M3 only
- `save_workflow` actually deploying user code to Render (mock URL fine through M1; real deploy may land in M2)
- Knowledge graph integration (Desmond's track) — out of project scope
- Multi-user, auth, persistence — not in M0–M3
- Streaming-tool-call UI polish — M2

## Milestone definitions (additive)

### M0 (lean local v0) — DONE

Chat loop works locally end-to-end. Tools defined inline in `/api/chat`. `run_code` uses local Python subprocess. Verified by Playwright + adversarial agent + evaluator. See "M0 done criteria" below.

### M1 (v0 plumbing) — current target

Same observable behavior as M0, but the architecture matches the original spec:
- 4 tools live on the **MCP server** (`agent/harness/mcp/server.py`), exposed via FastMCP + bearer auth.
- `/api/chat` connects to the deployed MCP server using `experimental_createMCPClient` and consumes the tools it advertises.
- `run_code` (on the MCP server) executes via **Render Workflows** `run_user_code` task, NOT local subprocess. Latency goes up to ~5s — acceptable for plumbing milestone, tuned in M2.
- `find_examples` and `save_workflow` move to MCP server filesystem (templates/ and saved/ live there).
- `ask_user` stays as a client-resolved tool surfaced through MCP (declared on server, no execute, frontend handles).
- Workflows service stays auto-deployed; MCP server stays auto-deployed via Blueprint.
- Frontend stays local for now (deploy is M2).

**M1 Done criteria:**
1. MCP server (`agent/harness/mcp/server.py`) advertises 4 tools when queried via `mcp/list_tools`.
2. `/api/chat` no longer defines tools inline — tools come from MCP client.
3. `run_code` invocation triggers a real Render Workflows task run (visible in the Render dashboard).
4. All 5 existing Playwright tests still pass against the new architecture (latency budget bumped to 60s/test for Workflows cold start).
5. Adversarial sub-agent re-runs 5 scenarios and gets ≥4/5 PASS.
6. Evaluator sub-agent verifies contract.
7. Notes (`03-progress-log.md`) updated with M1 entry.
8. Commits + push.

### M2 (v1 tuning) — pending

Frontend deploys to Render. End-to-end public URL works. Tool-call UI polished. Error handling smoothed. Cold-start mitigations applied (e.g. keep-alive ping for Workflows). Pre-pitch demo video.

### M3 (v2 swarm) — pending

The recursive fan-out demo. Out of scope until M1 + M2 land.

---

## M0 done criteria (preserved as historical reference)


## v0 — minimum viable chat loop

**Done = all of these green:**

1. `npm run dev` in `agent/harness/frontend/` starts the Next.js app on `localhost:3000`.
2. Page renders a chat input + message history.
3. User types `"compute the square of 7"` → submits.
4. `/api/chat` calls Anthropic Claude (Opus 4.7) with one tool: `run_code(code: string) -> {result, stdout, stderr}`.
5. LLM emits a `run_code` call with `code = "print(7**2)"` (or similar).
6. `run_code` executes the Python via `subprocess.run(["python3", "-c", code], timeout=30)`. Captures stdout/stderr. Returns to LLM.
7. LLM responds with `"49"` (or formatted equivalent) streamed back to chat.
8. **Verification:** Playwright test in `agent/scratchpad/p1-harness-mvp/tests/playwright/v0-smoke.spec.ts` passes — opens browser, types prompt, asserts `49` appears in chat within 30s.

## v1 — all four tools wired

Additive on top of v0. **Done = all of these green:**

1. `find_examples(query: string) -> Array<{title, description, code}>` returns up to 3 templates from a seeded `templates/index.json` (substring match). 3 templates seeded: hello-world, fetch-and-count-words, slack-ping (Composio stub).
2. `ask_user(question: string, options?: string[]) -> string` — frontend renders an inline prompt UI; user selects/types; answer flows back to LLM. Test: agent asks "should I proceed?", user clicks "yes", agent continues.
3. `save_workflow(name: string, code: string) -> {url: string}` — writes code to `agent/harness/frontend/saved/<name>.py`, returns mock URL `https://example.com/workflows/<name>`. Real Render deploy is v2.
4. Multi-step tool use works: user types `"fetch https://example.com and tell me the word count"`, LLM emits ≥2 sequential `run_code` calls, gets correct count.
5. Streaming visible: LLM tokens appear progressively, not all-at-once.
6. **Verification:** Playwright tests in `tests/playwright/v1-*.spec.ts` cover all 4 tools, each ≤30s. All pass.
7. **Adversarial verification:** sub-agent simulating an unfamiliar user runs 5 prompts (mix of math, web fetch, file write, asking question, ambiguous request). ≥4 produce useful output without crashing the server.

## Standards / promises

- **No silent failures.** Every error path returns a structured `{error: string}` to the LLM, never throws into the void.
- **No commented-out code.** Delete dead code before commit.
- **Tests live in `tests/playwright/`** with one `.spec.ts` per major flow. They're the contract; if they fail, work continues until green.
- **Notes stay current.** This file (`02-v0-v1-contract.md`) is updated as items land; sibling `03-progress-log.md` gets a chronological diary so the next agent (or me re-entering) can pick up cold.
- **Commits are atomic and pushed.** Each landed Done-criterion = one commit + push to `origin/jordan/microbot_harness_v0`. No giant end-of-session lump.
- **Evaluator runs before claiming done.** A sub-agent reads this file, runs the tests, and returns a verdict. If it says "not done," I don't stop.

## Tracking

Lives in TaskList. Each Done-criterion = one task. Mark in_progress on entry, completed on green test run. Don't mark completed on "I think it works" — only on test evidence.

## Verification commands

```bash
# v0 smoke
cd agent/harness/frontend && npm install && npm run dev &
cd agent/scratchpad/p1-harness-mvp/tests && npx playwright test v0-smoke.spec.ts

# v1 full
npx playwright test v1-*.spec.ts

# Manual sanity
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"compute the square of 7"}]}'
```

## Rejection criteria (when to redesign vs push through)

- If `/api/chat` can't reach Anthropic API for 3 consecutive runs → check `agent/.env` ANTHROPIC_API_KEY, escalate to Jordan only if the key itself is invalid.
- If `subprocess.run` of user code consistently times out >30s on simple `print(...)` → suspect environment issue, debug Python install in MCP service.
- If Playwright can't find Chrome → install via `npx playwright install chromium`.
- All other failures: debug, fix, retry. Don't hand off.
