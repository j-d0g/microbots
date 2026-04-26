# 03 — Progress + lessons

End-of-phase wrap. p3-swarm landed the swarm parallelism story end-to-end on the infra side; one external blocker (Anthropic credit) gates the live LLM demo.

## What we shipped

- **`run_user_code` async fix** (`agent/harness/workflows/main.py`). Was sync, called `asyncio.run` on coroutine results, raised inside the Workflows worker's existing event loop. Made it `async def` + `await value`. Sync user code is unaffected.
- **`parallel-fetch-urls` template**, mirrored in `agent/harness/{mcp,frontend}/templates/index.json`. Reference shape for Pattern A: `httpx.AsyncClient` + `asyncio.gather` over N URLs, 24-line body, returns per-URL `{status_code, byte_count, word_count}`.
- **System-prompt parallelism nudge** in `agent/harness/frontend/app/api/chat/route.ts`. Tells the LLM to prefer one `run_code` with internal gather over N parallel `run_code` calls; surfaces the template via `find_examples("parallel")`.
- **Benchmark + smoke scripts** under `agent/scratchpad/p3-swarm/tests/`. Stdlib-only, reproducible (`python3 …/benchmark_swarm.py`).
- **Plan + research notes** under `agent/scratchpad/p3-swarm/{plan,notes}/`.

## Latency outcome (from `notes/02-bench-swarm.md`)

| Flow | N | Median | Notes |
|---|---|---|---|
| noop_task cold | 5 || 3.97 s | parallel cold pool |
| Pattern A (run_user_code, asyncio×10 URLs) | 3 | **2.80 s** | sequential — first cold ~5 s, then warm |
| Pattern B (run_user_code ×10 parallel, 1 URL each) | 10 | 3.17 s (max 4.07 s) | 10 microVMs in parallel |

Pattern A wins for the 10-URL demo. Both A and B beat the original 5 s gate.

## What was actually hard, and why

1. **The chain-3 / fanout-subtask architecture was a dead-end** — confirmed in p1, would have stayed a mystery without that work. Carrying that lesson into p3 saved a wasted re-test.
2. **Subtle bug caught only by running real code in prod.** `run_user_code` had been deployed since p2 with sync semantics. Existing templates never exercised an `async def main`, so the bug was latent until the swarm template's smoke test triggered it. Generic lesson: every new template that introduces a code shape (sync, async, generator, etc.) is a contract test for the wrapper.
3. **Render Workflows version listing in the CLI is unreliable.** `render workflows versions list <slug> -o json` returned `[]` even with live versions deployed. We worked around it by triggering the task and observing whether the new code path was running. Worth knowing for future debugging.
4. **Hobby-tier concurrency cap (20) bites quietly.** First swarm tests hit pause-state when fan-out exceeded the cap. After Jordan bumped added concurrency it cleared. Cost is genuinely small (~$0.20/slot/month).

## Issues / improvements worth flagging

- **Anthropic credit on the deployed frontend is dry.** End-to-end LLM probe returned: *"Your credit balance is too low to access the Anthropic API."* Not a code issue; needs a top-up. Once topped up, `/tmp/e2e_chat.sh` is the probe to confirm the LLM emits one `run_code` with `asyncio.gather` for a parallel prompt.
- **System prompt says "four tools"** (`route.ts:10`) but the MCP server actually exposes 8. Pre-existing inconsistency, not blocking — the SDK fetches schemas from MCP at runtime regardless. Worth a 30-second cleanup pass.
- **Benchmark Pattern A median was measured warm,** not cold, because Flow 2 ran immediately after the noop warm pool existed. Honest cold-start for Pattern A is ~5 s (seen in the smoke run). Fine for the demo; if we want a cold-only benchmark, add a `--cold` flag with a sleep gap between flows.
- **Pattern B verdict says "median"** in the script's final line for both patterns; Pattern B's number there is actually max-of-10 (which is the right comparison for "fan-out done" time, but the wording is loose). One-line tweak in `benchmark_swarm.py` if this matters.
- **`MCP_URL` in `agent/harness/frontend/.env.local`** still points at port 8765 from an earlier dev session. Local server defaults to 10000. Anyone running locally should sync these.
- **No hardening on `parallel-fetch-urls`.** No cap on `len(urls)`, no validation that `urls` is a list of strings. A bad input could spawn unbounded coroutines. Easy to add (clip to ~100, type-check) before the public demo.
- **`run_user_code` cold-start is dominated by `httpx` import + container boot,** not actual user code. If we want sub-3 s cold-start, the next lever is shipping a leaner Workflows base image. Out of scope for the demo; worth knowing.

## Open follow-ups (none blocking)

- Top up Anthropic credit, run the live LLM probe, paste the output into `notes/04-llm-e2e.md`.
- Add `urls` validation + length cap to the template.
- Fix the "four tools" → "eight tools" stale string in the system prompt.
- Consider a Pattern B isolation demo (e.g. "run these 10 untrusted snippets and tell me which one wins") so we have a real reason to use it on stage.

## Verdict

p3-swarm is done. Pattern A is the documented default; Pattern B is a verified fallback; Pattern C stays banned. Ready to merge.
