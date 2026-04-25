# Agemo (CodeWords) Agent Architecture — Patterns for microbots

> Research lane R1 of the overnight ralph loop. Pattern extraction only — no code copied. Sources: `/Users/jordantran/Agemo/agemo/{AGENTS.md, .claude/, .agents/, containers/devx_mcp/, runtime/, sites/, agent-workspace/}`.

## TL;DR

Agemo runs two distinct agents: **Cody** (production user-facing automation assistant, served by `devx_mcp` over MCP, ~24 tools, mode-switched) and the **internal Claude harness** (engineers' agent, in-repo skills + hooks + worktrees). Both are organized around three reusable ideas microbots should adopt: (1) **just-in-time markdown navigation** — system prompts are skinny indexes that point to deeper docs the agent fetches via a `consult_docs` tool, (2) **explicit operating modes** with read-this-doc-first gates, and (3) **a reminder/rules engine** that injects situational nudges into the loop based on tool-call patterns. Skip the enforcement-rule heaviness, the per-service AGENTS.md sprawl, and the worktree machinery for v0.

---

## 1. Agents vs Skills vs Sub-agents — where the boundary sits

Agemo uses three structurally different concepts that look superficially similar:

- **Agents (Cody, Cursor, Claude harness)** — long-running conversational personas with a system prompt, tool registry, and a memory/context surface. Defined by a `SYSTEM.md`-class file plus tool wiring. There is exactly one Cody; there are multiple harness instances (one per worktree).
- **Skills (`.agents/skills/<name>/SKILL.md`)** — markdown-only "behavior packages" loaded into the *engineer's* Claude harness on demand. Each is a YAML-frontmatter file with `name`, `description`, optional `allowed-tools`, `context: fork` (run in subagent), `agent: Explore|Plan|general-purpose`. Most existing skills are single-line redirects to deeper docs (e.g. `e2e-testing` just says "read sites/TESTING.md"). They're an indirection layer, not capability code.
- **Sub-agents** — *forked* Claude instances with their own context window, dispatched via the `context: fork` field on a skill or via `Task`/`launch_sub_agent` tool calls. Used for parallel research, plan-then-execute splits, and isolating context-heavy work.

**Boundary rule (implicit):** if it needs its own context window or runs in parallel → sub-agent. If it's a stable tool surface a user converses with → agent. If it's a reusable instruction snippet that should auto-trigger on certain prompts → skill.

## 2. Tool registry pattern

`devx_mcp/service.py` is the canonical example. Tools are FastMCP-decorated async functions with **Pydantic-typed Annotated parameters carrying rich `Field(description=...)` strings** plus a triple-quoted docstring formatted with consistent sections: *When to use*, *Usage Tips*, *Examples*, *Returns*. The docstring **is** the LLM-visible documentation. Tools are registered automatically via the `@app.tool()` decorator on a single `FastMCP` app instance, then exposed over HTTP via `streamable_http_app()`.

Two interesting choices:
- **Tools fan out to internal services via HTTP**, not in-process calls. `consult_docs` reads markdown from disk, `run_workflow` proxies to `runtime`, `run_code` spins an E2B sandbox. The tool layer is thin orchestration over independently-deployed services.
- **One generic `run_workflow` tool replaces N specific tools** by taking a `workflow_id` + `path` + `inputs`. This keeps the visible surface small (24 tools) while exposing thousands of integrations behind the same dispatcher. Microbots should copy this — Composio adapter as a single `composio_invoke(toolkit, tool, args)` is cleaner than N tools per integration.

## 3. Memory & context layering into prompts

The Cody chat completion handler (`sites/.../create-completion.ts`) assembles each request as: **(1) System prompt** fetched live from `devx_mcp /system` endpoint → **(2) `{userinfo}` block** injected with `chatId`, name, email, plan → **(3) reminder enhancement** prepended/appended based on rules → **(4) MCP tool list** wrapped with per-call reminder hooks → **(5) message history** (with automatic compaction at ~400K tokens).

The system prompt itself (`SYSTEM.md`, ~210 lines / ~1500 tokens, capped at 3K) is **not** a knowledge dump — it's an **index of `consult_docs(["path/to/file.md"])` calls** the agent must make at decision points. "Before building, read 02-build-mode.md." "Before debugging, read 03-debug-mode.md." Knowledge stays on disk; the prompt teaches the agent the navigation grammar.

This maps cleanly onto microbots' `layer_index` + `drills_into` + `indexed_by` schema: each `layer_index` row's `agents.md` is the "skinny index" Cody would otherwise embed in its system prompt, and `consult_docs(layer_path)` becomes the fetch mechanism. The graph version is strictly better than Agemo's filesystem version because layers can encode token budgets, the FTS+HNSW lets the agent semantic-search rather than memorize paths, and the polymorphic `indexed_by` edge means a layer can be backed by any node type (not just markdown).

## 4. Harness structure — system prompt assembly, loop, errors, dispatch

Cody's loop is built on the **Vercel AI SDK `streamText`** (Anthropic Claude Opus 4.6). Iteration is sequential (`disableParallelToolUse: true` per the post-PR notes). Tool calls are wrapped to: log telemetry, evaluate reminder rules against accumulated tool-call history, append nudges into the next assistant turn. Errors propagate as tool result content (not exceptions); the agent is expected to read the error and self-correct. Compaction trims tool *outputs* aggressively while preserving tool *calls* (the trace), and at >400K tokens triggers an LLM-summarize cycle.

Sub-agent dispatch lives behind `launch_sub_agent` (an MCP tool, currently described as "specialized Cody instances connected to the same MCP" in the post-PR roadmap — partially implemented).

The internal Claude harness uses a different mechanism: **hooks** (`.claude/hookify.*.local.md`). Each is a markdown file with frontmatter declaring `event: stop|file|bash`, `action: block|warn`, plus regex/conditions. Examples: `block-git-push` blocks bash matching `git\s+push`, `block-secrets-edit` blocks file edits matching credential patterns, `stop-guard` blocks the agent from stopping until success criteria in `agent-workspace/GOALS.md` are met. Hooks are deterministic guardrails the harness enforces, separate from skills (which are LLM-visible behavior).

## 5. Prompt-engineering scaffolding worth borrowing

- **AGENTS.md hierarchy with `consult_docs`-style links** — root has cross-cutting routing, each section directory has its own. Root CLAUDE.md is one line: `Read AGENTS.md`. This avoids drift.
- **`Quick Start` block at the top of every AGENTS.md** with a numbered "read this, then this, then run this" sequence. Designed to orient an agent in <5 tool calls.
- **`Enforcement Rules` table** (cross-section change → required follow-up actions). The `If you change X, you MUST Y` pattern. Loud, scannable.
- **Mode docs (`01-chat-mode.md`, `02-build-mode.md`, `03-debug-mode.md`)** with explicit transition gates ("Complete the Consent + Research Gate before transitioning to Build Mode"). Keeps the agent from skipping due diligence.
- **`prompt.changelog`** — every system prompt change committed with rationale, A/B-tested in isolation. Production data feeds rule additions (frustrated vs happy thread tool-use ratios drove every Plan B reminder).
- **Reminder rules engine** — `sites/.../reminders/config.ts` defines ~35 rules each with `id`, `condition` (pure predicate over `ToolCallRecord` history), `message` (≤12 words, imperative), `timing` (pre-action / accumulation / post-failure). Three valid timings; rules that fire after success are explicitly banned as noise. Every rule is grounded in a real production failure case.

## 6. Per-ticket worktree pattern

Two worktree systems coexist:
- **`.worktrees/<ticket-slug>/`** at repo root — full git worktrees, one per parallel feature stream (`mem0-integration`, `pd-3413`, `poweruser-insight-overnight`). Used by humans/agents working on a single ticket without context switching.
- **`.claude/worktrees/<random-or-ticket>/`** — Claude-harness scratch worktrees auto-created by the harness, named e.g. `admiring-chaplygin-cbe0df` or ticket-prefixed.
- **`agent-workspace/`** — *not* a worktree, just a persistent shared scratch directory inside the repo with its own AGENTS.md + Session Init / Session Exit protocol + `v0/` `v1/` versioned phase folders containing `plans/`, `process/`, `research/`, `deliverables/`. Every agent is required to "persist something" before exiting.

The user already mirrors this for microbots (`agent-workspace/v0/v1/...`). The ROI pattern is the **persistence contract** ("no agent's work should exist only in context"), not the directory structure.

## 7. Patterns to PORT to microbots v0

| Pattern | Microbots application | Rationale |
|---|---|---|
| Skinny system prompt + `consult_docs` indirection | Wire pydantic-ai system prompt to a `read_layer(layer_id)` tool that pulls `agents.md` from the SurrealDB `layer_index` graph | Maps 1:1 onto the existing schema; keeps prompts under token budget; lets the agent semantic-search the graph instead of memorize paths |
| One generic dispatcher tool per integration provider | `composio_invoke(toolkit, tool, args)` not N tools | Keeps tool list to ~10 even with hundreds of integrations behind it |
| Operating modes with read-first gates | System 2 = "Reasoning Mode" + "Action Mode"; System 1 = "Consolidation Mode". Each has a doc the agent reads on entry | Already aligns with the System 1/2 design; the gate prevents the agent from skipping research |
| Reminder rules engine over tool-call history | Tiny pydantic-ai middleware that inspects the `ModelMessage` trace, fires named rules with ≤12-word imperative messages | Cheap to add (~50 LoC), high ROI for behavioral correction without bloating system prompt |
| Tool docstrings as LLM-visible API | Strict template: When to use / Usage Tips / Examples / Returns. Pydantic `Field(description=...)` on every param | Cody's tools are unusually well-described and it shows in tool-call quality |
| Hooks as deterministic guardrails | `block-secrets-edit`, `block-push-without-approval`, `stop-guard` style hooks for the founder-facing harness | Founders will run untrusted prompts; deterministic blocks are safer than relying on the LLM to refuse |
| Persistence contract for sub-agents | Every sub-agent must write its findings to `<lane>.md` before returning (this report is the live example) | Prevents context loss when the parent agent compacts |
| `prompt.changelog` discipline | A `CHANGELOG.md` next to the system prompt, every change with a one-line rationale + before/after | Foundation for sponsor demo: "look, we A/B tested every prompt change against real traces in Logfire" |

## 8. Patterns to SKIP for v0

| Skip | Reason |
|---|---|
| Per-service AGENTS.md (7 of them in Agemo) | Microbots is one repo with one agent; root AGENTS.md is enough until there's a second surface |
| Enforcement Rules cross-table | Premature; the codebase isn't large enough to need it |
| Multiple skill mode files (chat / build / debug) | Two modes (System 1 / System 2) is the design; don't fragment further |
| `.claude/hookify.*` markdown DSL | Use plain pydantic-ai validators or function decorators; markdown hooks are Claude-Code-specific |
| Worktree-per-ticket harness | Hackathon = one branch, one demo. Worktrees are for parallel long-lived feature streams |
| `disableParallelToolUse: true` | Cody is constrained by historical state-machine assumptions; pydantic-ai supports parallel tool use natively, take the win |
| FastMCP / streamable HTTP transport | Overkill for v0. Direct in-process tool calls are fine; only adopt MCP if a sponsor demo (Devin) needs the protocol |
| Reminder rules over a real production trace dataset | Defer rule authoring until Logfire has captured enough traces to ground rules in actual failures (Plan B took weeks; v0 should ship with maybe 3 hand-authored rules and grow from telemetry) |
| Two-domain UI deploy lifecycle, design_intelligence pre-step, scratchpad-to-S3 | All Cody-specific complexity solving Cody-specific problems |

---

## Appendix: file pointers

- `/Users/jordantran/Agemo/agemo/AGENTS.md` — root routing
- `/Users/jordantran/Agemo/agemo/.claude/hookify.*.local.md` — three hook examples
- `/Users/jordantran/Agemo/agemo/.agents/skills/{caveman,create-skill,e2e-testing,frontend-dev,live-preview,update-docs}/SKILL.md` — skill exemplars (all <30 lines)
- `/Users/jordantran/Agemo/agemo/containers/devx_mcp/SYSTEM.md` — Cody system prompt (the canonical "skinny index")
- `/Users/jordantran/Agemo/agemo/containers/devx_mcp/best_practices/00-cody-behavior/{01-chat-mode,02-build-mode,03-debug-mode}.md` — mode docs
- `/Users/jordantran/Agemo/agemo/containers/devx_mcp/service.py` — tool registry (FastMCP, 24 tools, ~3500 LoC)
- `/Users/jordantran/Agemo/agemo/containers/devx_mcp/AGENTS.md` — testing methodology, eval graders, production findings (this is the gem)
- `/Users/jordantran/Agemo/agemo/sites/apps/codewords-ui/src/features/chat/utils/reminders/config.ts` — reminder rules engine
- `/Users/jordantran/Agemo/agemo/sites/apps/codewords-ui/src/features/chat/api/create-completion.ts` — chat-completion assembly pipeline
- `/Users/jordantran/Agemo/agemo/agent-workspace/AGENTS.md` — Session Init / Session Exit / "every agent persists something" protocol
