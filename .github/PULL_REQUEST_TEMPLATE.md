<!--
  Default PR template. For UI-agent sprint PRs (anything touching
  web/lib/agent/**, web/components/rooms/**, web/components/stage/**,
  or web/agent-evals/**), the section below is REQUIRED.

  Non-agent PRs (knowledge_graph/**, agent/**, render_sdk/**, infra,
  etc.) can delete the "Agent eval delta" block and use a free-form
  summary.
-->

## Summary

<!-- 2-4 bullets: what shipped and why. -->

## Agent eval delta *(required for UI-agent PRs)*

Sprint: `<N — name>` · plan: [`web/agent-evals/AGENTS.md`](../web/agent-evals/AGENTS.md)

| Metric | Before | After | Δ |
|---|---|---|---|
| Tool-call correctness | | | |
| TTFW p50 (ms) | | | |
| Full-turn p50 / p95 (ms) | | | |
| Mean tool calls per turn (multi-step subset) | | | |
| Marginal-intent pass-rate | | | |
| Recovery rate | | | |
| Calm-canvas (judge avg) | | | |

Baseline report: `web/agent-evals/reports/<file>.json`
This PR's report: `web/agent-evals/reports/<file>.json`

### Regressions
<!-- List any metric that got worse, with rationale. If none, write "none". -->

## Test plan

- [ ] `npm --prefix web run typecheck` clean
- [ ] `npm --prefix web run lint` clean
- [ ] `npm --prefix web run agent:eval` ran; report committed
- [ ] If UI changed: smoke `.mjs` test added under `web/tests/` and Playwright screenshot under `web/tests/room-shots/`
- [ ] Sprint log updated at the bottom of `web/agent-evals/AGENTS.md`

Generated with [Devin](https://cli.devin.ai/docs)
