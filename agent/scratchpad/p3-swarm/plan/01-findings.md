# 01 — Findings

What we learned about Render Workflows parallelism in p1, and what that implies for the swarm phase.

---

## The earlier test was right; the pattern was wrong

In p1 we ran two probe tasks against `microbots` to answer "is Render Workflows fast and parallel enough to be the substrate for our coding agent?":

- `fanout_sum(n)` — a parent task that `await`s `n` parallel `trivial_compute(i)` subtasks via `asyncio.gather`.
- `chain_3(x)` — a parent that `await`s three subtasks sequentially (`step1 → step2 → step3`).

Numbers (after concurrency was bumped past Hobby's free 20 cap):

| Probe | Trial size | Median total | Verdict |
|---|---|---|---|
| `noop_task` | 5 parallel cold | **3.5 s** | ✅ fine |
| `fanout_sum(n=10)` | 3 trials | **13.3 s** | ⚠️ slow but works |
| `fanout_sum(n=50)` | 3 trials | none completed in 60 s | ❌ blew the wait window |
| `chain_3(x=5)` | 3 trials | **48 s** | ❌ way over the gate |

The chain-3 number is the smoking gun: a 3-step chain shouldn't take 48 s if each step is ~5 s. It costs *more* than 3× cold-start. That tells us the Workflows scheduler **evicts the parent task while it's awaiting a child**, so the parent pays cold-start again on resume. So the pattern "task A awaits task B awaits task C" multiplies cold-starts unpredictably.

Same root cause makes `fanout_sum` mediocre: the parent `await asyncio.gather(...)` lets the parent get evicted while children run, and the wake-up cost on every child completion stacks.

**Conclusion:** the architecture isn't broken. The "task awaits another task" primitive is.

---

## Three swarm patterns, ranked

### Pattern A — One task, internal asyncio.gather (the right default)

The LLM emits a single `run_user_code` body that does its own parallel I/O inside Python:

```python
import asyncio, httpx

async def main(args):
    async with httpx.AsyncClient(timeout=20) as c:
        responses = await asyncio.gather(*(c.get(u) for u in args["urls"]))
    return [r.status_code for r in responses]
```

- One Workflows run. One cold-start (~5 s).
- Internal parallelism is just async I/O — no Render API calls, no SDK overhead, no parent eviction.
- Latency = ~5 s + max(I/O time). For 50 HTTP fetches: ~5 s + ~1 s = **~6 s**.
- Bound by single container CPU/memory, but for I/O-heavy work (the agentic ETL pitch) that's irrelevant.
- Already supported by the harness — no infra change needed. Just a template + prompt nudge.

### Pattern B — Frontend fans out parallel `run_code` tool calls (the showpiece)

The LLM emits *N* parallel tool calls in one assistant turn. Vercel AI SDK runs them concurrently. Each lands as its own Workflows run.

- N concurrent Workflows runs in parallel. Each pays its own cold-start.
- Total latency = max(cold-start over N runs) ≈ **5 s for N up to concurrency cap**.
- True isolation between runs (one slow run doesn't block others).
- Result aggregation in the LLM's context — fine for small payloads, expensive for large.
- Needs the LLM to be willing to issue parallel calls (system prompt) and the frontend to handle concurrent tool execution (Vercel AI SDK does).

### Pattern C — Task spawns subtasks via SDK await (the failed pattern)

Our `fanout_sum` / `chain_3`. Already tested, already losing. Don't ship.

---

## Why this matters for the demo

The Render sponsor pitch wants "agent fans out work to 50 parallel jobs." We have two clean ways to demo that:

- A "scrape and summarise 50 URLs" flow via Pattern A — flat ~6 s, looks like magic.
- An "evaluate 10 candidates in parallel" flow via Pattern B — flat ~5 s, shows fan-out at the tool layer.

Both are well within Hobby + small added concurrency. Neither is bottlenecked on Render Workflows itself.

---

## Concurrency cost reality

Hobby plan: 20 concurrent task runs free. Added concurrency: ~$0.20/concurrent-slot/month, multiples of 5.

For demo scenarios:

| Demo scale | Concurrent runs | Added | Approx /month |
|---|---|---|---|
| Pattern A `n=50` | 1 | 0 | $0 |
| Pattern B `n=10` | 10 | 0 | $0 |
| Pattern B `n=50` | 50 | 30 | ~$6 |
| Pattern B `n=100` | 100 | 80 | ~$16 |

$50 sponsor credit absorbs all of these by orders of magnitude.

---

## Open questions to settle in the build

1. Does Pattern A with `n=50` httpx fetches actually fit in the bundled Workflows container memory? (Untested.) Easy to verify with one run.
2. Does the Vercel AI SDK reliably issue parallel tool calls when prompted to, or does it serialise them? (Untested in our setup.) Easy to verify by inspecting the streamed tool-call timestamps.
3. Cost-effectiveness of Pattern B at large N — at $0.05/hr × 5 s × 100 runs that's ~$0.07 per fan-out. Cheap for a demo, ugly if it's the production hot path. Document the trade-off.

These are confirmation questions, not architectural unknowns. None of them block.
