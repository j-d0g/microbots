# research/ — routing index

Archived ideation and research lives here. This folder is for provenance and reference, not the active build source of truth.

## Fast route

| If you need... | Go to |
|---|---|
| The compressed overnight summary | [`planning/skimple.md`](planning/skimple.md) |
| The stale-but-useful architecture draft | [`planning/design-v1.md`](planning/design-v1.md) |
| The old implementation plan / task breakdown | [`planning/plan-v1.md`](planning/plan-v1.md) |
| The most important later product insights | [`insights/key-insights.md`](insights/key-insights.md) |
| Sponsor / stack decisions | [`stack/`](stack/) |
| Agent harness patterns to steal | [`harness/`](harness/) |
| Raw conversation dumps | [`raw/`](raw/) |

## Directory map

### [`planning/`](planning/)

Archived planning docs from the overnight ralph loop. Useful for context, but some paths and execution assumptions are stale.

- [`skimple.md`](planning/skimple.md) — distilled overnight synthesis and highest-signal findings.
- [`handoff.md`](planning/handoff.md) — overnight decision log and wake-up checklist.
- [`design-v1.md`](planning/design-v1.md) — draft v1 architecture/design doc.
- [`plan-v1.md`](planning/plan-v1.md) — draft MVP implementation plan from the earlier weekend framing.
- [`progress.md`](planning/progress.md) — running log from the overnight loop.

### [`insights/`](insights/)

Small number of high-signal product/architecture insights that survived later pressure-testing.

- [`key-insights.md`](insights/key-insights.md) — the upstream stack-gap framing, card-deck suggestion UX, and live → consulting → rigid microbot lifecycle.

### [`stack/`](stack/)

Sponsor and platform research. Use this when wiring dependencies or deciding what to cut.

- [`pydantic-stack.md`](stack/pydantic-stack.md) — pydantic-ai + Logfire as the System 2 substrate; BYO Anthropic key caveat.
- [`surrealdb.md`](stack/surrealdb.md) — graph/doc/vector/FTS/live-query spine and multi-tenancy notes.
- [`composio.md`](stack/composio.md) — hosted auth + MCP tool execution.
- [`sponsor-glue.md`](stack/sponsor-glue.md) — Mubit, Render, and Anthropic OAuth dead-end.

### [`harness/`](harness/)

Patterns from other agent systems. Pull concepts, not code.

- [`agent-architecture.md`](harness/agent-architecture.md) — the upstream agent/Claude harness patterns: just-in-time markdown navigation, modes, reminders.
- [`runtime-pattern.md`](harness/runtime-pattern.md) — PEP-723 FastAPI workflow primitive and Render deployment idea.
- [`ralph-loop.md`](harness/ralph-loop.md) — while-true outer-loop pattern for iterative agent work.
- [`atomic-sdk.md`](harness/atomic-sdk.md) — frozen workflow graph, transcript hand-offs, model/tool tiers.
- [`coding-agents-external.md`](harness/coding-agents-external.md) — Devin and pi as peripherals rather than core substrate.
- [`kaig-martin.md`](harness/kaig-martin.md) — SurrealDB filesystem-as-graph, pydantic-ai shell tools, live-query UI.

### [`raw/`](raw/)

Unstructured source material. Only read this if you need quotes or provenance.

- [`braindump.md`](raw/braindump.md) — raw Martin/SurrealDB-oriented chat notes.
- [`whatsapp.md`](raw/whatsapp.md) — raw early team chat export.

## Research lane map

| Lane | Topic | File |
|---|---|---|
| R1 | agent + harness patterns | [`harness/agent-architecture.md`](harness/agent-architecture.md) |
| R2 | runtime pattern | [`harness/runtime-pattern.md`](harness/runtime-pattern.md) |
| R3 | Ralph loop | [`harness/ralph-loop.md`](harness/ralph-loop.md) |
| R6 | SurrealDB v2 | [`stack/surrealdb.md`](stack/surrealdb.md) |
| R7 | Pydantic-AI + Logfire | [`stack/pydantic-stack.md`](stack/pydantic-stack.md) |
| R8 | Composio | [`stack/composio.md`](stack/composio.md) |
| R9 | Devin + pi | [`harness/coding-agents-external.md`](harness/coding-agents-external.md) |
| R10 | Mubit / Render / Anthropic OAuth | [`stack/sponsor-glue.md`](stack/sponsor-glue.md) |
| — | Atomic SDK | [`harness/atomic-sdk.md`](harness/atomic-sdk.md) |
| — | kaig / Martin | [`harness/kaig-martin.md`](harness/kaig-martin.md) |
| — | Morning conversation insights | [`insights/key-insights.md`](insights/key-insights.md) |
| — | Raw conversation inputs | [`raw/`](raw/) |

R4 and R5 outputs are not present here; check [`planning/progress.md`](planning/progress.md) for the original overnight activity log.
