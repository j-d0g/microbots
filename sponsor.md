# Sponsors

Microbots is built on sponsor infrastructure in ways that are core to product behavior, not demo decoration. Each sponsor below is part of a load-bearing path in our architecture: memory, orchestration, deployment, reliability, and the live-to-rigid automation lifecycle.

## Pydantic (pydantic-ai + Logfire)

Pydantic is our agent runtime contract.

- **Typed agent loop:** `pydantic-ai` powers our orchestrator and tool-calling surface with strict input/output schemas, validation retries, and structured outputs. This is how we keep agent behavior deterministic enough to productionize.
- **Composable multi-agent execution:** we run specialist agents via agent-as-tool delegation with shared usage tracking, so nested calls stay traceable and cost-accountable across a single mission.
- **Streaming + UI compatibility:** the runtime supports streamed responses/events for interactive chat while preserving typed outputs for downstream automation steps.
- **Ralph-loop observability:** **Logfire** instruments FastAPI + pydantic-ai end-to-end, so each self-driving loop run captures: model calls, tool calls, retries, validation failures, timing, token usage, and cost.
- **Why it matters:** this gives us a verifiable control plane for autonomous operation. We are not just prompting an LLM; we are operating a typed, inspectable system that can run unattended.

## Cognition (Devin)

Cognition is integrated as a production worker in our automation pipeline, not as a side demo.

- **Spec-to-PR execution:** Microbots emits a structured implementation spec and dispatches Devin sessions through API, then tracks session status until PR output.
- **Dev acceleration in our own stack:** we use Devin for targeted code scaffolding and refactors in our internal development loop when tasks are well-scoped and parallelizable.
- **Cloud self-driving loops:** in higher-complexity workflow candidates, Devin acts as the crystallization worker that converts repeated successful agent behavior into deterministic code artifacts.
- **QA and verification path:** Devin-generated changes are treated as proposals and pass through validation gates (tests/review/preview checks) before merge, which keeps reliability high while preserving speed.
- **Why it matters:** Cognition is the bridge between exploratory intelligence and deployable software. It directly supports our Live -> Consulting -> Rigid microbot lifecycle.

## Render

Render is our execution substrate across interactive and autonomous modes.

- **Two-tier runtime:** Web Services handle low-latency interactive agent traffic; Workflows/Cron handle asynchronous fan-out, overnight consolidation, and scheduled missions.
- **Agent fan-out primitive:** our swarm pattern maps naturally to Workflow task chaining/fan-out, giving us distributed execution for parallel subproblems without building orchestration infrastructure ourselves.
- **Microservice promotion path:** when a workflow stabilizes, we can package and deploy dedicated Python services for customers on Render with isolated runtime boundaries.
- **Deployment unification:** APIs, workers, and supporting services run on the same platform with shared operational controls, which reduces architectural friction and speeds iteration.
- **Why it matters:** Render is not just where we host; it is how we express the product’s core compose-and-swarm behavior in production.

## Mubit

Mubit is our execution-memory layer for continuous improvement.

- **Lesson capture from real runs:** we capture outcome-level memory (success/failure patterns, edge cases, operational context) from agent executions.
- **Run-to-run adaptation:** relevant lessons are injected back into subsequent agent calls, improving reliability without changing the core mission interface for users.
- **Lifecycle fuel:** Mubit is the memory engine behind our transition from expensive reasoning-heavy runs to cheaper deterministic workflows.
- **Safety through reversibility:** when deterministic paths degrade, lessons from new failures help us route back to a more reasoning-rich mode and re-stabilize.
- **Why it matters:** Mubit makes learning persistent at execution time, which is essential for our self-improving automation model.

## Why This Sponsor Stack Fits Naturally

This stack is cohesive because each sponsor maps to a distinct architectural responsibility:

- **Pydantic/Logfire:** typed cognition + observability
- **Cognition:** code crystallization + high-leverage execution worker
- **Render:** distributed runtime + deployment substrate
- **Mubit:** execution memory + adaptation loop

Together, they form one continuous system: capture intent -> reason and act -> observe outcomes -> learn -> harden -> deploy.
