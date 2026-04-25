# Atomic SDK — Fit Evaluation for microbots

## TL;DR

**Verdict: Port concepts, do not adopt the SDK.** Atomic is a TypeScript-on-Bun harness that orchestrates *external* coding-agent CLIs (Claude Code, OpenCode, Copilot CLI) via tmux sessions and transcript hand-offs. It is structurally incompatible with a Python/FastAPI + pydantic-ai service that runs its own agent loop in-process. The patterns (frozen workflow graph, transcript-only hand-offs, per-stage tool/model tiers) are gold and should be ported.

## What Atomic is

Atomic (flora131/atomic) is an open-source CLI + TypeScript SDK that wraps production coding-agent CLIs in deterministic, multi-session pipelines. It does **not** run an LLM loop itself — it spawns Claude Code / OpenCode / Copilot in isolated tmux sessions and coordinates their transcripts. The pitch: encode "research → spec → implement → review → debug" as a reproducible TS pipeline that runs identically on every dev machine and CI box. Headline use cases are Ralph-style autonomous loops and parallel codebase research with sub-agents.

The local trial worktree at `/Users/jordantran/Agemo/agemo/.worktrees/atomic-trial/` contains **no atomic-specific additions** — its diff against main is unrelated kuby/k8s/UI work. Treat this as "branch reserved, never populated."

## Architecture / primitives

- **Workflow** — `defineWorkflow({...}).for("claude").run(async ctx => …).compile()`. `.compile()` freezes topology; no runtime mutation. Determinism is the central promise.
- **Stage** — a function inside the workflow that opens a session, queries the agent, and `s.save(sessionId)`s its transcript. Stages compose with plain TS: `Promise.all` for fan-out, `for` for sequential, `break` on signal phrases.
- **Session** — a tmux-managed instance of a coding-agent CLI. Fresh context window per stage. The agent's native chat UI (streaming, slash commands, model picker) is preserved.
- **Transcript** — the *only* data channel between stages. Downstream stages read upstream transcripts via `ctx.transcript(stageRef)`. No shared mutable state.
- **Sub-agents** (12 built-in: planner, worker, reviewer, debugger, codebase-analyzer, codebase-locator, …) — scoped contexts and tool sets, dispatched within a stage.
- **Skills** (57 built-in, version-controlled) — auto-invoked capability files; same shape as Claude Code skills.
- **Per-stage tiering** — headless analysis stages skip permissions and use cheaper models; user-facing stages inherit the orchestrator model; refinement loops can gate on human-in-the-loop.
- **Session graph** — visual tmux graph of nodes, deps, and transcript hand-offs.

## Fit with microbots stack (Python + pydantic-ai)

Direct adoption is a non-starter:

1. **Runtime mismatch.** Atomic is Bun-only TS. It refuses Node, has zero Python bindings. A FastAPI process cannot import it. Shelling out to `atomic` would mean booting Bun + tmux per request — operationally hostile and pointless inside a server.
2. **Mental-model mismatch.** Atomic orchestrates *external* CLIs (Claude Code et al.) as black-box subprocesses. microbots *is* the agent loop — pydantic-ai already owns the tool loop, model client, and tool registry in-process. Atomic adds a layer microbots fundamentally doesn't need.
3. **Concurrency model mismatch.** Atomic's isolation primitive is "fresh tmux session." microbots' equivalents are async tasks, separate pydantic-ai `Agent` instances, and SurrealDB-scoped memory namespaces. Same goal, different substrate.
4. **Integration-shape mismatch.** Atomic has no notion of an iframe UI streaming tokens to a browser, nor of Composio tool registries. Bolting it on would mean writing a parallel server to talk to Atomic's tmux sessions — strictly worse than running pydantic-ai directly.
5. **Determinism-vs-product mismatch.** Atomic's value prop is reproducible *dev pipelines* (Ralph, research). microbots is a user-facing agent product. Frozen DAGs are the wrong granularity for "user sends a message."

## Patterns to borrow

These are the high-ROI ideas to lift into a Python harness around pydantic-ai. Name them so we can refer back:

1. **Frozen workflow graph.** Define the topology of a multi-step task once (Python builder or pydantic model), then `.compile()` it so the loop cannot mutate edges at runtime. Map: implement as a pydantic-validated DAG in microbots' planner. Defends against agents that wander.
2. **Transcript-only hand-off.** Each stage's only output is a stored artefact (SurrealDB record / typed pydantic event). Downstream stages read by reference, never by shared memory. Map: every microbot step writes a typed `StageResult` to Surreal; the next step reads it explicitly. Forces context discipline.
3. **Per-stage tool + model tiering.** "Cheap headless model + no permissions" for analysis stages, "premium model + human gate" for user-visible stages. Map: pydantic-ai `Agent` instances are cheap to spin up — give each stage its own `Agent(model=…, tools=[…])` instead of one fat agent.
4. **Sub-agent decomposition with scoped contexts.** Planner / worker / reviewer / locator pattern. Each gets only the context it needs. Map: microbots already wants this; copy the role taxonomy and the convention that sub-agents are dispatched *inside* a stage, not across stages.
5. **Skill files as version-controlled capabilities.** Atomic skills are markdown + frontmatter, intentionally authored, not auto-generated. Map: keep microbot "skills" as git-tracked files alongside Composio integrations — avoid runtime skill drift.
6. **Session-graph visibility.** Render the live DAG of stages, deps, and transcript edges. Map: cheap win in the iframe UI — a small graph view of the in-flight workflow makes long runs legible.
7. **`for`-loop + `break`-on-signal as the autonomy primitive.** Ralph is just a Python `while not done:` loop with a phrase guard. Don't build a state machine until this hurts.
8. **Devcontainer-as-isolation.** For any tool calls that touch the filesystem or shell, run them in a sandbox (already implied by microbots' Composio model — reinforce it).

## Recommendation

**Port concepts; ignore the SDK.** Specifically:

- Adopt patterns 1–4 in microbots' core loop *before* the hackathon demo: frozen graph, typed transcript hand-off, per-stage agent/model tiering, sub-agent role taxonomy.
- Treat patterns 5–7 as fast follows.
- Do not vendor, fork, or shell out to Atomic. There is no scenario where a Bun/tmux harness improves a Python/FastAPI in-process agent server.
- Update the existing memory note ("Atomic = TypeScript Harness for Claude Code and Multi-Agent Workflows") to add: *"Patterns inform microbots; runtime does not slot in. See agent-workspace/docs/research/atomic-sdk.md."*

Sources: github.com/flora131/atomic, deepwiki.com/flora131/atomic, alexlavaee.me/blog/open-claude-design-atomic-harness/.
