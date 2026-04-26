# p3-swarm — Render Workflows parallelism / swarm phase

**Branch:** `jordan/microbot_harness_v0` (live working branch; harness implementation is in `agent/harness/`).
**Why this exists:** earlier parallelism tests (p1, see `notes/00-render-workflows-cold-start.md` on the previous branch) used a task-spawns-subtasks pattern that ran into parent eviction and free-tier concurrency caps. The architecture isn't broken — we just picked the wrong primitive. This phase establishes which primitive *does* work and bakes it into the harness so the LLM uses it by default.

## Status as of 2026-04-26

**DONE.** Pattern A live in prod, benchmark verdict captured, prompt nudge merged. Ready for review/merge.

- Plan + spec: `plan/01-findings.md`, `plan/02-spec.md`, `plan/03-handoff.md`.
- Pattern A smoke: `notes/01-pattern-a-smoke.md` — PASS at 4.75 s for 10 URLs.
- Pattern B SDK research: `notes/01-pattern-b-parallel-toolcalls.md` — Vercel AI SDK runs concurrent tool calls in parallel, no config change needed.
- Benchmark: `notes/02-bench-swarm.md` — Pattern A median 2.80 s (warm), Pattern B median 3.17 s, max 4.07 s.
- Wrap + lessons + open follow-ups: `notes/03-progress.md`.

**Single open external blocker:** Anthropic API credit on the deployed frontend is dry; live LLM end-to-end test pending top-up. Not a code issue.

## Document map

- `plan/01-findings.md` — Pattern A vs B vs C analysis with the latency numbers from the previous phase. What works, what doesn't, why.
- `plan/02-spec.md` — what to build for the swarm phase: one template, prompt nudge, frontend support for parallel tool calls, and a benchmark.
- `plan/03-handoff.md` — verification gates, decisions to lock, deviation rules.
- `notes/` — running notes during the build (cold-start retests, prompt iterations, demo recordings).
- `tests/` — measurement scripts and benchmark outputs.
