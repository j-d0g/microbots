# p3-swarm — Render Workflows parallelism / swarm phase

**Branch:** `jordan/microbot_harness_v0` (live working branch; harness implementation is in `agent/harness/`).
**Why this exists:** earlier parallelism tests (p1, see `notes/00-render-workflows-cold-start.md` on the previous branch) used a task-spawns-subtasks pattern that ran into parent eviction and free-tier concurrency caps. The architecture isn't broken — we just picked the wrong primitive. This phase establishes which primitive *does* work and bakes it into the harness so the LLM uses it by default.

## Status as of 2026-04-26

- Plan + spec drafted (`plan/01-findings.md`, `plan/02-spec.md`, `plan/03-handoff.md`).
- Implementation not started.

## Document map

- `plan/01-findings.md` — Pattern A vs B vs C analysis with the latency numbers from the previous phase. What works, what doesn't, why.
- `plan/02-spec.md` — what to build for the swarm phase: one template, prompt nudge, frontend support for parallel tool calls, and a benchmark.
- `plan/03-handoff.md` — verification gates, decisions to lock, deviation rules.
- `notes/` — running notes during the build (cold-start retests, prompt iterations, demo recordings).
- `tests/` — measurement scripts and benchmark outputs.
