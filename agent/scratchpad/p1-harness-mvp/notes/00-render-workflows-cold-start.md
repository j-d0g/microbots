# Render Workflows Cold Start — noop_task

## Gate: HARD STOP if median >5s — escalate to Jordan before Phase 1.

| Run | Trigger time (UTC) | Result received (UTC) | Latency (s) | Notes |
|-----|--------------------|-----------------------|-------------|-------|
|     |                    |                       |             |       |

## How to measure
1. Record wall time before `render workflows tasks start noop_task --input='{}'` (or SDK call).
2. Record wall time when run status = `succeeded` via `render workflows runs view <run-id>` or API poll.
3. Latency = succeeded_at - triggered_at.

## Verdict
- [ ] PASS (<5s median over 3 runs)
- [ ] FAIL (>5s) — HARD STOP, escalate
