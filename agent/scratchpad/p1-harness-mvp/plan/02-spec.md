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
| `consult_docs(paths: list[str]) -> dict[str, str]` | Returns markdown content for each path. Paths reference a bundled docs corpus. | Drives RAG. Without it the agent hallucinates platform specifics. Seed 3–5 docs. |
| `search_templates(query: str, limit: int) -> list[dict]` | Returns matching template entries with id/title/desc/tags. | Substring or fuzzy match over a static `templates/index.json`. Don't add embeddings — overkill for P1. |
| `run_code(code: str, args: dict) -> {result, stdout, stderr, error}` | Executes code in an isolated Workflows container. Times out at ~120s. | The workhorse. Wraps `client.workflows.start_task("<workflows-svc>/run_user_code", {code, args})`. |
| `Ask_User_A_Question(question, options?) -> answer` | Pauses execution, surfaces a UI prompt, returns the user's answer. | Client-resolved (the frontend handles it; MCP server has no impl). Mandatory before destructive actions per upstream system-prompt principles. |
| `Set_Behavior_Mode(mode)` | No-op if P1 has only one mode. | Drop entirely if mode-switching isn't shown in the demo. |

---

## Components

For each: purpose, contract, recommended tech, alternatives if blocked, verification check.

### 1. Frontend (`agent/harness/web/` — Next.js 14+ App Router)

**Purpose:** Chat UI. Stream LLM responses. Display tool-call progress (especially `run_code` and step results).

**Contract:** Single page at `/` driven by `useChat({ api: "/api/chat" })`. The `/api/chat` Route Handler:
1. Reads request, derives session id from a cookie (single-user demo: random uuid in cookie if missing).
2. Loads chat history from Postgres for that session.
3. Connects to MCP server via `experimental_createMCPClient` over Streamable HTTP using `MCP_API_TOKEN`.
4. Calls `streamText({ model, tools: <fetched>, messages })`.
5. Streams the response via `toUIMessageStreamResponse()`.
6. After the stream completes, persists the new turn to Postgres.

**Recommended tech:** Next.js, Tailwind (or shadcn/ui), `@ai-sdk/react`, `ai`, `@modelcontextprotocol/sdk`, Anthropic via Vercel AI Gateway.

**Alternatives if blocked:** vanilla HTML + EventSource + a single API endpoint. MCP-Inspector standalone works for a backend-first demo.

**Env vars:**
- `ANTHROPIC_API_KEY` (or `AI_GATEWAY_API_KEY`)
- `MCP_SERVER_URL`
- `MCP_API_TOKEN`
- `DATABASE_URL`

**System prompt** (initial draft, store at `web/lib/system-prompt.md`):

```
You are a coding agent. Users describe tasks in natural language; you decompose into steps, write Python, run it via the run_code tool, observe output, and continue until the task is done.

Tools:
- consult_docs(paths) — read internal docs
- search_templates(query) — find example workflows
- run_code(code, args?) — execute Python in an isolated container; returns stdout, return value, errors
- Ask_User_A_Question(question, options?) — ask the user before destructive or ambiguous actions

Style:
- Be concise. Show code before running.
- Run code one step at a time; observe and reason between runs.
- If a library is missing, surface that — don't fake the call.
- Confirm before sending external messages, deleting data, or doing anything you can't undo.
```

### 2. MCP server (`agent/harness/mcp_server/` — Python, FastMCP, FastAPI)

**Purpose:** Host the 5 MCP tools. Bearer auth. Read/write Postgres for chat history.

**Contract:**
- `GET /health` → `{"status": "ok"}` (bypasses auth)
- `POST /mcp` (FastMCP path) — Streamable HTTP MCP, requires `Authorization: Bearer <MCP_API_TOKEN>`

**Recommended tech:** Python 3.11+, `mcp` (FastMCP), `fastapi`, `uvicorn`, `httpx`, `psycopg[binary]` or `asyncpg`, `render_sdk` (PyPI), `python-dotenv`.

**Layout (suggested — adapt):**
```
mcp_server/
├── server.py
├── tools/
│   ├── consult_docs.py
│   ├── search_templates.py
│   ├── run_code.py
│   └── (Ask_User_A_Question, Set_Behavior_Mode are client-resolved)
├── docs/
│   ├── how-to-write-a-workflow.md
│   ├── how-to-use-composio.md
│   └── ...
├── templates/
│   └── index.json
└── pyproject.toml
```

**Tool sketches:**

```python
# tools/consult_docs.py
@mcp.tool()
def consult_docs(paths: list[str]) -> dict[str, str]:
    """Read one or more markdown docs from the bundled docs corpus.
    Returns {path: content}. Unknown paths are silently skipped."""
    return {p: (Path("docs") / p).read_text() for p in paths if (Path("docs") / p).is_file()}

# tools/search_templates.py
@mcp.tool()
def search_templates(query: str, limit: int = 5) -> list[dict]:
    """Search the template index by tag / description fuzzy match."""
    index = json.loads(Path("templates/index.json").read_text())
    # substring or fuzzy match — embeddings are overkill at 3–5 templates
    ...

# tools/run_code.py
@mcp.tool()
async def run_code(code: str, args: dict | None = None, timeout_seconds: int = 120) -> dict:
    """Execute Python in an isolated Render Workflows container.
    Returns {result, stdout, stderr, error?}.
    User code may import the pre-bundled libs (composio, httpx, openai, anthropic, pydantic, bs4, pandas, ...)."""
    client = RenderClient()
    run = await client.workflows.start_task(
        f"{WORKFLOWS_SERVICE_SLUG}/run_user_code",
        {"code": code, "args": args or {}}
    )
    final = await run.wait(timeout_seconds=timeout_seconds)
    return final.output
```

**Bearer auth:** copy `BearerAuthMiddleware` from `render-examples/mcp-server-python` (≈30 LOC). Token from `os.environ["MCP_API_TOKEN"]`.

**Alternatives if FastMCP fights you:** hand-rolled MCP (Streamable HTTP + JSON-RPC) is acceptable.

**Env vars:**
- `MCP_API_TOKEN`
- `RENDER_API_KEY` (workflows SDK)
- `RENDER_WORKFLOWS_SERVICE_ID` (slug used in `task_identifier`)
- `DATABASE_URL`
- *(optional)* `LOGFIRE_TOKEN`

### 3. Workflows service (`agent/harness/workflows/` — Python, Render Workflows SDK)

**Purpose:** Host the single scratch-task that exec()s arbitrary Python. Pre-bundle deps so user code can import them.

**Contract:** One registered task `run_user_code(code: str, args: dict | None) -> dict`. Returns `{result, stdout, stderr, error}`.

**Recommended tech:** Python 3.11+, `render_sdk` (PyPI Workflows SDK — NOT Daud's local `microbots/render_sdk/`).

**Layout:**
```
workflows/
├── tasks.py        # The whole scratch task
├── pyproject.toml  # Pre-bundled deps
└── README.md
```

**The whole `tasks.py`:**

```python
import asyncio, io, contextlib, traceback, json
from render_sdk import Workflows

app = Workflows()

@app.task
async def run_user_code(code: str, args: dict | None = None) -> dict:
    """Execute arbitrary Python code. Returns stdout, stderr, return value, or error."""
    args = args or {}
    stdout = io.StringIO()
    stderr = io.StringIO()
    result = None
    error = None

    namespace: dict = {"args": args, "asyncio": asyncio}
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exec(code, namespace)
            if "main" in namespace and callable(namespace["main"]):
                fn = namespace["main"]
                if asyncio.iscoroutinefunction(fn):
                    result = await fn(args)
                else:
                    result = fn(args)
    except Exception as e:
        error = {"type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc()}

    try:
        json.dumps(result)
    except (TypeError, ValueError):
        result = repr(result)

    return {
        "result": result,
        "stdout": stdout.getvalue(),
        "stderr": stderr.getvalue(),
        "error": error,
    }

if __name__ == "__main__":
    app.start()
```

**Pre-bundle these deps and no more** (image size affects cold start):

```
composio, httpx, openai, anthropic, pydantic,
beautifulsoup4, pandas, pyyaml, requests
```

If user code requires an unlisted lib, surface the `ImportError` to the LLM rather than auto-installing.

**Verification:** SDK trigger from the MCP server returns the expected dict for `code = "result = 5*5"` — `{"result": 25, "stdout": "", "stderr": "", "error": None}`.

**Alternatives if Render Workflows is unavailable:** fall back to a Web Service that exec()s on POST, with subprocess isolation (loses Firecracker but keeps the architecture). Log in `notes/decisions-changed.md`.

**Env vars:** *(optional)* `COMPOSIO_API_KEY`, `LOG_LEVEL`.

### 4. Render Blueprint (`render.yaml` at repo root)

```yaml
services:
  - type: web
    name: microbot-harness-mcp
    runtime: python
    plan: starter
    rootDir: agent/harness/mcp_server
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn server:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: MCP_API_TOKEN
        generateValue: true            # Render auto-generates a token
      - key: RENDER_API_KEY
        sync: false                    # paste at deploy
      - key: RENDER_WORKFLOWS_SERVICE_ID
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: DATABASE_URL
        fromDatabase:
          name: microbot-harness-db
          property: connectionString

  - type: web
    name: microbot-harness-web
    runtime: node
    plan: starter
    rootDir: agent/harness/web
    buildCommand: pnpm install --frozen-lockfile && pnpm build
    startCommand: pnpm start
    autoDeploy: true
    envVars:
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: MCP_SERVER_URL
        fromService:
          name: microbot-harness-mcp
          type: web
          property: hostport
      - key: MCP_API_TOKEN
        fromService:
          name: microbot-harness-mcp
          type: web
          envVarKey: MCP_API_TOKEN
      - key: DATABASE_URL
        fromDatabase:
          name: microbot-harness-db
          property: connectionString

  # The Render Workflows service:
  # Verify exact `type:` against current Render Blueprint docs at
  # https://render.com/docs/blueprint-spec — at the time of writing,
  # blueprint support for type=workflow may need a manual deploy step.
  # If blueprint support is missing, deploy via dashboard / CLI
  # (`render workflows init` then "+ New > Workflow") and feed its slug
  # to the MCP server via RENDER_WORKFLOWS_SERVICE_ID.

databases:
  - name: microbot-harness-db
    plan: starter
    postgresMajorVersion: "16"
```

### 5. Postgres schema (initial)

```sql
CREATE TABLE chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_cookie TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content JSONB NOT NULL,        -- raw AI SDK message format
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_thread_idx ON chat_messages(thread_id, created_at);
```

Migrations: a single `migrations/0001_init.sql` is fine. Apply via `psql` or a tiny script. Don't pull in alembic for P1.

---

## Data flow — one user turn

1. User types in browser → `POST /api/chat` with messages array.
2. Route handler reads cookie → loads thread + recent messages from Postgres.
3. Calls `streamText({ model: anthropic("claude-opus-4-7"), tools: <fetched from MCP>, messages })`.
4. LLM emits text chunks + tool calls. Each `run_code` tool call → MCP server → `start_task("<workflows-svc>/run_user_code", {code, args})` → poll → return result to LLM.
5. LLM iterates with tool results, may call more tools.
6. Final response streams to browser via SSE.
7. After stream ends, persist new messages to Postgres.

**Latency budget per user turn (target):** initial token < 2s, full response < 30s for a 3-step chain. Cold start of Workflows runs is the main risk; measure in Phase 0.

---

## Hard constraints

- **Workflows, not Web Service per workflow.** Per-workflow Web Service deploy = 1–5 min dead air during demo. The scratch-task pattern is non-negotiable for P1. (Fallback to Web-Service-exec only if Workflows is genuinely unavailable; log in `notes/decisions-changed.md`.)
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
- System prompt content (use upstream system prompt as inspiration; cut to ~30 lines)
- Pre-bundled libs *list extension* (add only if Phase 2/3 demos need it)

---

## Build phases

Each ends in a verification gate. If a gate fails, stop and debug — don't move on.

### Phase 0 — Scaffold + measure (½ day)

**Owner:** `infra` agent.

- Scaffold subdirs under `agent/harness/`: `mcp_server/`, `web/`, `workflows/`.
- Add `render.yaml` at repo root.
- Add `migrations/0001_init.sql`.
- Set up Render account (GitHub OAuth), connect this repo, verify deploy of an empty service.
- Deploy MCP server with the `ping` tool.
- Deploy Workflows service with `noop_task() -> "ok"` and **measure cold-start latency** of one run. Record in `notes/00-render-workflows-cold-start.md`.

**Verification (HARD GATE):**
- `curl https://<mcp-svc>.onrender.com/health` → 200 OK
- MCP Inspector lists `ping`, calls it, returns expected output.
- Workflows SDK from local machine triggers `noop_task` → returns `"ok"` end-to-end.
- **Cold-start latency recorded in `notes/`.** If consistently >5s, STOP and escalate.

### Phase 1 — Static loop (1 day)

**Owners:** `tools` (MCP server) + `frontend` (browser) — parallel.

- Implement `consult_docs(paths)` reading from `mcp_server/docs/`. Seed 3–5 docs.
- Implement `search_templates(query)` over `mcp_server/templates/index.json`. Seed 3 stub templates.
- Build the Next.js chat UI. Connect to MCP server via `experimental_createMCPClient`. System prompt loaded from file.
- Wire Postgres for chat history.

**Verification:**
- A real LLM connects to the deployed MCP, lists 5 tools, calls `consult_docs(["how-to-write-a-workflow.md"])`, gets content back.
- Browser-driven chat: user types "what can you do?", LLM responds with grounded text referencing the seed docs.

### Phase 2 — Code execution (1.5 days)

**Owners:** `tools` + `infra` parallel.

- Implement `run_code(code, args)` in MCP server: calls `start_task("<workflows-svc>/run_user_code", ...)` and awaits result.
- Update `workflows/tasks.py` with the full `run_user_code` per the sketch above.
- Pre-bundle deps in `workflows/pyproject.toml`.
- Persist tool calls + outputs to Postgres so chat history reflects them.

**Verification:**
- "Square the input": user asks "compute 5 squared," LLM writes Python, calls `run_code`, gets `25`, replies. End-to-end < 15s.
- Multi-step: user asks "fetch a URL and count words," LLM does it in two steps via two `run_code` calls.

### Phase 3 — Composio integration (1 day)

**Owner:** `tools`.

- Pre-install `composio` in workflows container. Document required env vars and auth steps in `mcp_server/docs/how-to-use-composio.md`.
- Seed one Composio template.
- End-to-end demo: user says "send a Slack message to channel X saying Y."

**Verification:**
- Real Slack message lands in a real channel via Composio. Latency under ~10 seconds.

### Phase 4 — Polish (½ day, optional)

- `Ask_User_A_Question` confirmation gate (UI hook in the frontend that pauses the stream).
- One non-trivial template (e.g. "scrape these N URLs and summarize each").
- Logfire integration (lift `microbots/log.py`).
- Loading states / nice typography.
- Capture demo video.

**Verification:** 90-second demo video, no dead air >15s per step.

---

## Phase-0 doc seeds

Each ~10 lines. Stubs for `mcp_server/docs/`. The LLM uses these to ground itself, not the user.

- `how-to-write-a-workflow.md` — "Define `main(args)`. Use `httpx`, `composio`, etc. Return JSON-serializable values."
- `how-to-use-composio.md` — "`from composio import Composio; c = Composio(); c.actions.execute(...)`. Pre-authed apps in our setup: Slack, Gmail, Linear."
- `available-libraries.md` — list of pre-bundled libs in the scratch container.
- `style-guide.md` — "Print intermediate state. Wrap external calls in try/except. Return JSON-serializable values."

---

## Don't waste time on

- Building your own MCP server transport. Use FastMCP from the Render template.
- Writing a Render REST API client. Use the official `render_sdk` PyPI package for Workflows ops.
- Auto-installing libraries inside the scratch task at runtime — surface the error instead.
- Multi-tenancy / per-user JWT / RBAC. Single-user demo.
- A real validation step at deploy. The upstream `validate_service` is advisory; we don't have a deploy step in P1 anyway.
- Embeddings for `search_templates`. Substring match is enough for 3–5 templates.
- Sub-agents (`launch_sub_agent`). Doesn't exist on upstream main; not needed for P1.
- Lifting `microbots/render_sdk/`. Wrong primitive (Web Service deploys, not Workflows). Naming-collision risk with PyPI `render_sdk`.
