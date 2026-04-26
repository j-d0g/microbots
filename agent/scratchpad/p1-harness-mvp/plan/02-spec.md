# 02 — Spec

What to build, opinionated only where research informs the choice. Standard engineering decisions are yours.

---

## What we're shipping

A chat-driven coding agent. User asks for something in natural language, the LLM decomposes into steps, generates Python, runs it via a Render Workflows scratch-task, observes output, continues until done. ChatGPT-Code-Interpreter shape, but with Composio tool reach (Slack/Gmail/Linear/etc.) and Render Workflows as the substrate.

**Success criterion:** judge visits the URL, types a request, sees real multi-step output in <30s. At least one step touches an external service via Composio.

---

## Architecture

```
Browser (Next.js + Vercel AI SDK useChat)
    │ SSE
    ▼
microbot-harness-mcp (Render Web Service, Python)
    ├ FastMCP + bearer auth (token from generateValue)
    ├ LLM call (Anthropic, via Vercel AI SDK or direct)
    ├ 5 MCP tools
    └ Postgres for chat history
        │
        │ run_code → render_sdk.Workflows.start_task
        ▼
microbot-harness-workflows (Render Workflows, Python)
    └ ONE task: run_user_code(code, args) — exec()s code, returns stdout/result
```

Three deploy artifacts. One repo. One `render.yaml`.

---

## The five tools

Contracts only. Implementation is yours.

| Tool | Contract | Notes |
|---|---|---|
| `consult_docs(paths: list[str]) -> dict[str, str]` | Returns markdown content for each path. Paths reference a bundled docs corpus. | Drives RAG. Without it the upstream agent hallucinates platform specifics. Seed 3–5 docs. |
| `search_templates(query: str, limit: int) -> list[dict]` | Returns matching template entries with id/title/desc/tags. | Substring or fuzzy match over a static `templates/index.json`. Don't add embeddings — overkill for P1. |
| `run_code(code: str, args: dict) -> {result, stdout, stderr, error}` | Executes code in an isolated Workflows container. Times out at ~120s. | The workhorse. Wraps `client.workflows.start_task("<workflows-svc>/run_user_code", {code, args})`. |
| `Ask_User_A_Question(question, options?) -> answer` | Pauses execution, surfaces a UI prompt, returns the user's answer. | Client-resolved (the frontend handles it; MCP server has no impl). Mandatory before destructive actions per the upstream agent system-prompt principles. |
| `Set_Behavior_Mode(mode)` | No-op if P1 has only one mode. | Drop entirely if mode-switching isn't shown in the demo. |

---

## Render Workflows scratch-task

The whole `tasks.py` is one function. Pseudocode:

```
@app.task
async def run_user_code(code: str, args: dict | None = None) -> dict:
    Capture stdout/stderr.
    exec(code, namespace) where namespace pre-imports the bundled deps.
    If `main(args)` is defined in the code, call it (await if coroutine).
    Best-effort json-serialize the result; fall back to repr.
    Return {result, stdout, stderr, error?}.
```

**Pre-bundle these deps and no more** (image size affects cold start):

```
composio, httpx, openai, anthropic, pydantic,
beautifulsoup4, pandas, pyyaml, requests
```

If user code requires an unlisted lib, surface the ImportError to the LLM rather than auto-installing.

---

## Hard constraints

- **Workflows, not Web Service per workflow.** Per-workflow Web Service deploy = 1–5 min dead air during demo. The scratch-task pattern is non-negotiable for P1.
- **5-tool surface.** Don't add tools without logging the reason in `notes/decisions-changed.md`.
- **Single-user demo, no auth screens.** Session cookie for chat history continuity is enough.
- **One workflows service, one task.** Don't build named-task-per-workflow; that's the save-as-workflow path, deferred to Phase 4.

---

## Soft choices (your call)

These were left undecided on purpose. Common-sense defaults are fine; deviate freely:

- LLM provider (Anthropic direct, Vercel AI Gateway, OpenRouter — any work via Vercel AI SDK)
- Frontend framework (Next.js recommended; vanilla HTML+EventSource acceptable if Node tooling fights you)
- DB driver (psycopg / asyncpg — pick what ships fastest)
- Migration tool (none needed for P1; one SQL file is fine)
- Test framework (pytest, vitest, playwright — your call)
- Module structure within each component
- System prompt content (use a concise upstream system prompt as inspiration; cut to ~30 lines)
- Pre-bundled libs *list extension* (add only if Phase 2/3 demos need it)

---

## Build phases

Each ends in a verification gate. If a gate fails, stop and debug — don't move on.

### Phase 0 — Scaffold + measure
Get Render account connected. Deploy three skeleton services. Hit `/health` on the MCP server. Trigger a no-op Workflows task and **record cold-start latency** in `notes/00-render-workflows-cold-start.md`.

If cold start is >5s consistently: stop. Write findings, escalate. The plan needs revision (fall back to E2B for `run_code`, or keep-alive ping the workflows container).

### Phase 1 — Static loop
Build `consult_docs` + `search_templates`. Seed 3–5 doc files + 3 template entries. Wire frontend to MCP server. Browser test: user asks "what can you do?", LLM responds grounded in the docs.

### Phase 2 — Code execution
Implement `run_code`. Implement the scratch-task. Browser test: "compute 5 squared" → end-to-end <15s. Two-step: "fetch URL and count words" → end-to-end <30s.

### Phase 3 — Composio integration
Pre-install `composio` in workflows container. Seed one Composio template. Browser test: "send a Slack message saying X to channel Y" — real Slack message lands.

### Phase 4 — Polish (optional)
`Ask_User_A_Question` UI gate. Loading states. One non-trivial template. Demo video.

---

## Phase-0 doc seeds

Each ~10 lines. Don't write production docs; the LLM uses these to ground itself, not the user.

- `how-to-write-a-workflow.md` — "Define `main(args)`. Use `httpx`, `composio`, etc. Return JSON-serializable values."
- `how-to-use-composio.md` — "`from composio import Composio; c = Composio(); c.actions.execute(...)`. Pre-authed apps in our setup: Slack, Gmail, Linear."
- `available-libraries.md` — list of pre-bundled libs.
- `style-guide.md` — "Print intermediate state. Wrap external calls in try/except."

---

## Don't waste time on

- Building your own MCP server transport. Use FastMCP from the Render template.
- Writing a Render REST API client. Use the official `render_sdk` PyPI package for Workflows ops.
- Auto-installing libraries inside the scratch task at runtime — surface the error instead.
- Multi-tenancy / per-user JWT / RBAC. Single-user demo.
- A real validation step at deploy. an upstream `validate_service` is advisory; we don't have a deploy step in P1 anyway.
- Embeddings for `search_templates`. Substring match is enough for 3–5 templates.
- Sub-agents (`launch_sub_agent`). Doesn't exist on the upstream codebase main; not needed for P1.
