# 02 — Swarm pattern benchmark

Run: 2026-04-26 ~08:35 UTC, immediately after `b3f3bde` deployed (`run_user_code` async fix). Workspace concurrency was bumped earlier to support fan-out.

## Results

| Flow | N | Median | P90 | Max | Min | Notes |
|---|---|---|---|---|---|---|
| noop_task cold | 5 | 3.97 | 4.28 | 4.34 | 3.58 | parallel |
| Pattern A (run_user_code, asyncio×10) | 3 | **2.80** | 3.52 | 3.70 | 2.63 | sequential, 10 URLs each |
| Pattern B (run_user_code ×10 parallel) | 10 | 3.17 | 3.86 | 4.07 | 2.73 | parallel, 1 URL each |

All times in seconds.

**Winner for 10-URL demo: Pattern A at 2.80s median (one task, internal asyncio.gather).**

## Reading the numbers

- Pattern A is faster than the *cold* noop baseline because Flow 2 ran after Flow 1's warm pool existed; the first Pattern A run reused a warm container. Honest cold latency for Pattern A is ~5s (we saw 4.75s in the smoke immediately after deploy).
- Pattern B's max-of-10 (4.07s) is the right comparison for "10-URL demo done" time. Slightly slower than Pattern A but still well under the 5s gate.
- Variance on Pattern B is tighter than expected (2.73–4.07s) — workspace concurrency bump cleared the queueing issues we saw on free-tier in p1.
- All 10 Pattern B runs ran genuinely in parallel — no `paused` status, no timeouts.

## Decision

- **Default the LLM to Pattern A.** One `run_code` call with internal `asyncio.gather` is the right primitive for parallel I/O. Faster, cheaper (1 Workflows run vs N), and avoids any chance of hitting concurrency caps.
- **Reserve Pattern B for true-isolation cases.** When each item legitimately needs its own container (e.g. running untrusted code per input, hard memory isolation between jobs), the LLM can fire N parallel `run_code` calls. The Vercel AI SDK already executes them concurrently (Lane B verified this).
- **Pattern C (task awaits subtask) stays banned.** Not retested here; the p1 `chain_3` 48s number stands.

## Cost sanity check

At Pattern B `n=10`, each run is ~4s on free starter tier. At $0.05/hr × ~4s × 10 runs = ~$0.0006 per fan-out. Even a hammered demo doesn't touch the $50 credit.

Pattern A at the same workload is one run × ~5s = ~$0.00007. An order of magnitude cheaper.

## Reproduce

```
python3 agent/scratchpad/p3-swarm/tests/benchmark_swarm.py
```

Stdout is markdown; pipe to a file if you want to update this table from a future run.

## Next step

Phase 1: add the system-prompt nudge in `frontend/app/api/chat/route.ts` so the LLM picks Pattern A by default for parallel I/O work.
