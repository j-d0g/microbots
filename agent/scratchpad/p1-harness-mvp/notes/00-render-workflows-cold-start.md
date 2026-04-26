# 00 — Render Workflows cold-start

**Goal:** verify per-run latency on Render Workflows is <5s so the scratch-task architecture is viable. Plan hard-stop: >5s consistently → pivot substrate.

## Setup

- Workflow service: `microbots` (Python), slug `microbots`, id `wfl-d7mn9n9f9bms7383cad0`
- Commit deployed: `704adf5`
- Task: `noop_task` (returns `{"status": "ok"}` immediately)
- Region: oregon, free plan

## Runs

### Sequential (dashboard-triggered, 3 runs)

First run after deploy likely fully cold.

| run_id | total |
|---|---|
| `trn-...nanbeo5us73et9p60` (1st) | **7.53s** |
| `trn-...nanreo5us73et9pf0` (2nd) | 5.21s |
| `trn-...naon7f7vs73faanf0` (3rd) | 3.41s |

Interpretation: 1st cold, 2nd partially warm (within ~3s of 1st), 3rd warm.

### Parallel burst (CLI-triggered, 10 runs)

Fired in <1s via `ThreadPoolExecutor(max_workers=10)` to force parallel Firecracker microVMs. Queue time consistently 226–306 ms (tight), so variation is in exec time = container boot + SDK import.

| | queue_ms | exec_ms | total_ms |
|---|---|---|---|
| min | 226 | 3417 | **3656** |
| median | 279 | 4812 | **5160** |
| p90 | 288 | 5464 | **5961** |
| max | 306 | 5655 | **5961** |
| mean | 269 | 4629 | **4899** |

Two fastest runs (3.6s, 3.8s) likely grabbed warm instances from the earlier sequential burst. Filtering those out:

- Cold-only median: ~5.3s
- Cold-only p90: ~6.0s

## Verdict vs the 5s gate

**Marginal.** Cold-start is ~5–6s, which is *at* or *just over* the hard-stop. Warm-start is ~3–3.5s, which is fine.

Not a clean pass, not a clean fail. Two mitigation paths:

1. **Warm-keep-alive.** Have the MCP web service ping `noop_task` every ~60s while a user session is active. Container stays warm → users see warm-start latency only. Costs more per-hour while sessions are active, but scale-to-zero still applies between sessions.
2. **Stream LLM tokens during code-run wait.** Mask the 5s by showing the LLM's preamble ("Let me compute...") while the workflow spins up. Doesn't fix latency but hides it perceptually.

Either mitigation keeps the architecture viable. Pivoting to E2B would be heavier work than doing both of the above.

## Recommendation

**Green-light Phase 1** with warm-keep-alive added to the MCP server during Phase 2 (when `run_code` is wired up).

## Decision (2026-04-26)

Sticking with Render Workflows (sponsor). Strategy:

1. Lean into parallelism / fan-out as a product feature — the architecture naturally supports this since each run is its own microVM.
2. Fallback flag for demo safety: if cold-start becomes an issue during live demo, wire a `RUN_ON_SERVER=true` path that executes generated Python in-process on the MCP web service (bypassing Workflows). Acceptable for a single-user demo, not for production.

## Raw-data reproduction

Script at `/tmp/coldstart.py` (or see commit trail). Task ID: `tsk-d7mnajkorq7c73cr9f00`.
