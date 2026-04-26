# 02 — Spec

What to build for the swarm phase. Opinionated where we know the answer; left open where the call is yours.

---

## What we're shipping

Two things:

1. **Make Pattern A the default.** The harness must guide the LLM to do parallel I/O *inside* one `run_user_code` task using `asyncio.gather`, not by chaining tool calls or spawning subtasks. This is a one-template + one-prompt-nudge change, plus a benchmark.
2. **Enable Pattern B as a stretch.** Allow the LLM to fire multiple `run_code` calls in one assistant turn for cases where isolation matters. Confirm Vercel AI SDK runs them concurrently end-to-end.

Both must be demonstrable against the deployed harness on Render. Neither involves changing the Workflows substrate, the MCP server's tool schemas, or the deploy infra.

---

## Concrete deliverables

### 1. New template: `parallel-fetch-urls`

`agent/harness/mcp/templates/index.json` (and the frontend's mirror): one new entry. ~15 lines of source. Fetches a list of URLs in parallel via `httpx.AsyncClient` + `asyncio.gather`, returns `{url, status_code, byte_count, word_count}` for each, plus a total elapsed.

The template is the LLM's reference implementation for Pattern A. `find_examples("parallel fetch")` should surface it.

### 2. System-prompt nudge

`agent/harness/frontend/app/api/chat/route.ts` `SYSTEM_PROMPT`: add ~3 lines:

> When the user asks for parallel work (multiple URLs, N candidates, fan-out), prefer **one** `run_code` call that uses `asyncio.gather` internally over multiple sequential `run_code` calls. Only issue parallel `run_code` calls when each item needs full isolation (e.g. running untrusted code on different inputs).

### 3. Pattern-B verification (no code change expected)

The Vercel AI SDK already supports parallel tool calls in `streamText`. Confirm it does by issuing a prompt that legitimately wants parallel `run_code` (e.g. "run these three Python snippets and tell me which is fastest"), inspect the tool-call timestamps in the streamed response, and record the result in `notes/01-pattern-b-parallel-toolcalls.md`. If it serialises by default, document the config flag needed (likely `experimental_toolCallStreaming` or similar).

### 4. Benchmark script

`tests/benchmark_swarm.py` — measures three flows back-to-back, three trials each, reports median total latency:

- `noop_task` baseline (cold, n=5 parallel).
- Pattern A: `run_user_code` fetching 10 URLs in parallel via internal asyncio.
- Pattern B: 10 parallel `run_code` calls, each fetching one URL.

Output is a small markdown table appended to `notes/02-bench-swarm.md`.

### 5. Notes update

Once benchmark is run, write `notes/02-bench-swarm.md` with the numbers and the call: which pattern wins for the demo, and at what N.

---

## Hard constraints

- Don't add subtask-spawning patterns (no `await other_task(...)` from inside `run_user_code` or any other task). Chain-3 already proved this is dead.
- Don't change the MCP tool schemas. The 8 tools stay as they are.
- Don't grow the Workflows bundled deps. If a template needs something not bundled, surface the import error.
- Don't add new MCP services. Everything happens through `run_code`.

---

## Soft choices (your call)

- N for the demo (5? 10? 50?) — depends on what reads as "swarm" without bursting concurrency.
- Whether to wire a UI affordance ("run this in parallel" button) or rely entirely on the LLM emitting the right call shape.
- Where the Pattern A template URLs come from (hardcoded list in the demo, user-provided, scraped from a query — judges respond to provenance).
- Whether to bump added concurrency to 30 (~$6/mo) for a more dramatic showpiece, or stay free.

---

## Phases

### Phase 0 — Confirm assumptions
- Quick smoke run of `run_user_code` with a 10-URL `asyncio.gather` body. Verify httpx is bundled and the call returns within ~6 s.
- Quick smoke check of Vercel AI SDK parallel tool calls.

### Phase 1 — Template + prompt
- Add `parallel-fetch-urls` to both `index.json` files.
- Update `SYSTEM_PROMPT`.
- One end-to-end browser test: ask "fetch these 5 URLs and tell me which is biggest" and confirm the LLM uses `find_examples` then emits one `run_code` with internal gather.

### Phase 2 — Benchmark + decision
- Run the benchmark script. Record numbers.
- Pick winning pattern for the demo. Update `notes/02-bench-swarm.md`.

### Phase 3 — Demo-ready polish (optional)
- Loading states / progress streaming during the 5–6 s wait.
- Better template for the actual demo flow (e.g. Composio-flavoured: "ping 10 Slack channels in parallel").
- Talking-points note for the pitch: cost numbers, Render Firecracker isolation story, "one task, internal parallelism" vs "fan-out tool calls" decision tree.

---

## Don't waste time on

- Trying to fix the chain-3 / nested-await pattern. Confirmed broken at the platform level; not our problem to solve.
- Building a generic swarm DSL on top of Workflows. The LLM emitting Python is the DSL.
- Caching MCP client connections. Per-request handshake is fine for v0; revisit if it shows up in profiling.
- Postgres for benchmark history. Single markdown table is enough.
- A separate dashboard for swarm runs. Render's existing run list shows everything.
