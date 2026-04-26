"""MCP server for the microbot harness.

Exposes 8 tools to the chat agent:
  - run_code       — executes Python via Render Workflows run_user_code task
  - find_examples  — substring search over templates/index.json
  - save_workflow  — writes code to saved/<name>.py, returns URL
  - view_workflow  — reads back a saved workflow's source (mirror of save)
  - run_workflow   — invokes a saved workflow by name (load + run)
  - list_workflows — lists all saved workflows with one-line summaries
  - search_memory  — searches user's KG and recent chats (V1 stub)
  - ask_user       — schema-only; resolved by the frontend (client-side tool)
"""

import hmac
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

# ---------- Config ----------

MCP_API_TOKEN = os.environ.get("MCP_API_TOKEN")
RENDER_EXTERNAL_HOSTNAME = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
RENDER_API_KEY = os.environ.get("RENDER_API_KEY")
WORKFLOWS_TASK = os.environ.get("WORKFLOWS_TASK", "microbots/run_user_code")

# Paths relative to this file so behavior is the same locally and on Render.
HERE = Path(__file__).parent
TEMPLATES_PATH = HERE / "templates" / "index.json"
SAVED_DIR = HERE / "saved"
SAVED_DIR.mkdir(parents=True, exist_ok=True)

# Hardening caps (adversarial findings p2-v1-tools/notes/02-adversarial-findings.md)
MAX_SLUG_LEN = 64        # filesystem-safe; far below ext4/APFS NAME_MAX (255)
MAX_CODE_BYTES = 1_000_000  # 1 MB hard ceiling on saved workflow source


# ---------- Render Workflows client (lazy) ----------

_render_client = None


def _render():
    global _render_client
    if _render_client is None:
        from render_sdk import Render

        _render_client = Render()
    return _render_client


# ---------- MCP server + tools ----------

mcp = FastMCP(
    "microbot-harness-mcp",
    stateless_http=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=bool(RENDER_EXTERNAL_HOSTNAME),
        allowed_hosts=[RENDER_EXTERNAL_HOSTNAME] if RENDER_EXTERNAL_HOSTNAME else [],
    ),
)


@mcp.tool()
async def run_code(code: str, args: dict | None = None) -> dict:
    """Execute Python code in a Render Workflows runner.

    Returns {result, stdout, stderr, error}. Pre-imports httpx, requests,
    beautifulsoup4 in the runner namespace. Cold start ~3-7s; warm ~3s.
    Use print() for values you want to see in stdout.
    """
    import asyncio

    def _go() -> dict:
        client = _render()
        # start_task returns immediately; poll get_task_run until terminal.
        # Avoids run_task's SSE long-poll which blocks the asyncio event loop.
        started = client.workflows.start_task(WORKFLOWS_TASK, [code, args or {}])
        run_id = started.id
        deadline = time.monotonic() + 120  # 2 min wall-clock cap
        while time.monotonic() < deadline:
            details = client.workflows.get_task_run(run_id)
            status = getattr(details, "status", None)
            if status in ("completed", "succeeded"):
                results = getattr(details, "results", None) or []
                if results:
                    return results[0]
                return {"result": None, "stdout": "", "stderr": "", "error": "no result returned"}
            if status in ("failed", "cancelled", "errored"):
                return {
                    "result": None,
                    "stdout": "",
                    "stderr": "",
                    "error": f"workflows status={status}: {getattr(details, 'error', '')}",
                }
            time.sleep(0.5)
        return {"result": None, "stdout": "", "stderr": "", "error": "workflows timeout (>120s)"}

    try:
        # Off the event loop so we don't block other MCP requests.
        return await asyncio.to_thread(_go)
    except Exception as exc:  # noqa: BLE001
        return {"result": None, "stdout": "", "stderr": "", "error": f"workflows error: {exc}"}


@mcp.tool()
def find_examples(query: str) -> dict:
    """Search the template library by keyword. Returns up to 3 matches.

    Each match has id, title, description, tags, and full source code.
    Use this BEFORE writing code if you suspect a template might match.
    """
    try:
        templates = json.loads(TEMPLATES_PATH.read_text())
    except FileNotFoundError:
        return {"matches": [], "count": 0, "error": "templates file not found"}

    q = query.lower()
    words = [w for w in q.split() if w]
    scored = []
    for t in templates:
        haystack = (t["title"] + " " + t["description"] + " " + " ".join(t["tags"])).lower()
        score = sum(1 for w in words if w in haystack)
        if score > 0:
            scored.append((score, t))
    scored.sort(key=lambda pair: -pair[0])
    matches = [t for _, t in scored[:3]]
    return {"matches": matches, "count": len(matches)}


def _slugify(name: str) -> str:
    """Normalise a workflow name to a filesystem-safe slug.

    Truncates to MAX_SLUG_LEN (64) chars to avoid OSError on very long
    names — adversarial probe found 1000-char names crashed with
    Errno 63 (file name too long).
    """
    slug = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    return slug[:MAX_SLUG_LEN].rstrip("-")


def _first_summary(text: str) -> str:
    """Extract a one-line summary from a Python source file.

    Prefers the first line of the module docstring; falls back to the first
    non-blank, non-import, non-comment line.
    """
    m = re.search(r'^"""([^"\n]+)', text, re.MULTILINE)
    if m:
        return m.group(1).strip()
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or s.startswith("import") or s.startswith("from"):
            continue
        return s[:120]
    return ""


@mcp.tool()
def save_workflow(name: str, code: str, overwrite: bool = False) -> dict:
    """Persist a Python snippet as a named workflow.

    Writes to saved/<slug>.py and returns a stable URL. Use when the user
    asks to save / promote / publish work.

    By default REFUSES to overwrite an existing workflow — returns
    {error: "exists", slug, existing_bytes} so the agent can decide
    whether to ask_user, pick a new name, or call again with
    overwrite=True. This prevents silent data loss on slug collision
    (e.g. "data sync" and "data-sync" share the same slug).

    Caps:
      * slug length capped at 64 chars (longer names truncate)
      * code size capped at ~1 MB (refuses larger payloads)
    """
    slug = _slugify(name)
    if not slug:
        return {"error": "invalid name (must produce a non-empty slug)"}
    code_bytes = len(code.encode("utf-8"))
    if code_bytes > MAX_CODE_BYTES:
        return {
            "error": "code too large",
            "bytes": code_bytes,
            "max_bytes": MAX_CODE_BYTES,
        }
    target = SAVED_DIR / f"{slug}.py"
    if target.exists() and not overwrite:
        existing_bytes = target.stat().st_size
        return {
            "error": "exists",
            "slug": slug,
            "existing_bytes": existing_bytes,
            "hint": "pass overwrite=True to replace, or pick a different name",
        }
    target.write_text(code, encoding="utf-8")
    return {
        "url": f"https://example.com/workflows/{slug}",
        "saved_to": str(target),
        "bytes": code_bytes,
        "overwritten": overwrite and target.exists(),
    }


@mcp.tool()
def view_workflow(name: str) -> dict:
    """Read back the source of a previously saved workflow.

    Use to inspect existing workflows before editing or running them — the
    agent's read-back partner to save_workflow. Without this, every
    conversation starts from scratch because the agent has no way to see
    what's already in saved/<slug>.py.

    Returns {name, slug, code, bytes} on success, or {error} if missing.
    """
    slug = _slugify(name)
    if not slug:
        return {"error": "invalid name (must produce a non-empty slug)"}
    target = SAVED_DIR / f"{slug}.py"
    if not target.exists():
        return {"error": f"workflow not found: {slug}"}
    code = target.read_text(encoding="utf-8")
    return {
        "name": name,
        "slug": slug,
        "code": code,
        "bytes": len(code.encode("utf-8")),
    }


@mcp.tool()
async def run_workflow(name: str, args: dict | None = None) -> dict:
    """Invoke a saved workflow by name with optional arguments.

    Loads saved/<slug>.py and executes it via the same Render Workflows
    runner that backs run_code. Use this when the user wants to invoke
    something already saved (their own past work, or something the agent
    saved earlier in the session) — distinct from run_code, which executes
    ad-hoc snippets.

    Returns the same shape as run_code: {result, stdout, stderr, error}.
    """
    slug = _slugify(name)
    if not slug:
        return {"result": None, "stdout": "", "stderr": "", "error": "invalid name"}
    target = SAVED_DIR / f"{slug}.py"
    if not target.exists():
        return {
            "result": None,
            "stdout": "",
            "stderr": "",
            "error": f"workflow not found: {slug}",
        }
    code = target.read_text(encoding="utf-8")
    return await run_code(code, args)


@mcp.tool()
def list_workflows() -> dict:
    """List all saved workflows with their slugs and a short summary.

    Sorted by most-recently-modified first, so the agent surfaces the
    user's recent work naturally. Use this when the user asks "what have
    I built?" or refers ambiguously to a past workflow.

    Each entry: {slug, summary, bytes, modified}.
    """
    items: list[dict[str, Any]] = []
    for path in SAVED_DIR.glob("*.py"):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        items.append({
            "slug": path.stem,
            "summary": _first_summary(text),
            "bytes": path.stat().st_size,
            "modified": path.stat().st_mtime,
        })
    items.sort(key=lambda d: -d["modified"])
    return {"workflows": items, "count": len(items)}


@mcp.tool()
async def search_memory(query: str, scope: str = "all") -> dict:
    """Search the user's memory for context grounded in their own data.

    Scopes:
      - "kg":           knowledge graph (Slack, Notion, Gmail, Linear, GitHub)
      - "recent_chats": rolling summaries of the user's last 1 / 7 days (stub)
      - "all":          both, merged and re-ranked

    Returns ranked results, each with {source, scope, snippet, score}.
    Prefer this BEFORE asking the user open-ended context questions — the
    answer is often already in their data.

    V1 wiring: scope "kg" / "all" proxies to kg_mcp's `kg_memories_top` tool
    over streamable-HTTP MCP and substring-filters the result by `query`.
    Real ranked search (FTS / vector) is a P3 follow-up. scope "recent_chats"
    stays empty until the chat-summary pipeline lands.
    """
    # scope=recent_chats → no pipeline yet; honest empty.
    if scope == "recent_chats":
        return {"results": [], "query": query, "scope": scope,
                "note": "recent_chats pipeline not yet implemented"}

    kg_url = os.environ.get("KG_MCP_URL", "https://kg-mcp-2983.onrender.com/mcp")
    try:
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        async with streamablehttp_client(kg_url) as (read, write, _):
            async with ClientSession(read, write) as kg:
                await kg.initialize()
                resp = await kg.call_tool("kg_memories_top",
                                          {"params": {"by": "confidence", "limit": 50}})
        # FastMCP returns content as a list of TextContent — payload is a JSON string.
        text = "".join(getattr(c, "text", "") for c in (resp.content or []))
        rows = json.loads(text) if text else []
    except Exception as exc:  # noqa: BLE001
        return {"results": [], "query": query, "scope": scope,
                "error": f"kg_mcp unreachable: {exc.__class__.__name__}"}

    q = (query or "").lower().strip()
    matched = []
    for row in rows if isinstance(rows, list) else []:
        content = str(row.get("content") or row.get("text") or "")
        if not q or q in content.lower():
            matched.append({
                "source": f"kg:{row.get('id', 'memory')}",
                "scope": "kg",
                "snippet": content[:300],
                "score": float(row.get("confidence") or 0.0),
            })
    matched.sort(key=lambda r: -r["score"])
    return {"results": matched[:10], "query": query, "scope": scope}


@mcp.tool()
def ask_user(question: str, options: list[str] | None = None) -> dict:
    """Pause and ask the user a confirmation question.

    Use BEFORE destructive actions (sending messages, writing files outside
    saved/, calling paid APIs). The user's answer is returned as a string.

    NOTE: this tool is resolved by the chat client — the server returns a
    placeholder so MCP introspection works. The Vercel AI SDK / frontend
    intercepts the tool call and renders a UI prompt; the user's answer is
    submitted as the tool result.
    """
    return {
        "_client_resolved": True,
        "question": question,
        "options": options or [],
    }


# ---------- Health + auth ----------


@mcp.custom_route("/health", methods=["GET"])
async def health(request: Request) -> Response:
    return JSONResponse({"status": "ok", "ts": time.time()})


class BearerAuthMiddleware:
    """Constant-time bearer-token check; bypassed for /health."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] == "/health":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        auth = headers.get(b"authorization", b"").decode()
        if hmac.compare_digest(auth, f"Bearer {MCP_API_TOKEN}"):
            await self.app(scope, receive, send)
            return

        response = JSONResponse(
            {
                "jsonrpc": "2.0",
                "error": {"code": -32001, "message": "Unauthorized"},
                "id": None,
            },
            status_code=401,
        )
        await response(scope, receive, send)


def create_app():
    # SSE transport — compatible with the Vercel AI SDK MCP client.
    # (Streamable HTTP is also supported by FastMCP via mcp.streamable_http_app(),
    # but the Vercel client currently only supports SSE.)
    app = mcp.sse_app()
    if MCP_API_TOKEN:
        app.add_middleware(BearerAuthMiddleware)
    return app


if __name__ == "__main__":
    import uvicorn

    if not MCP_API_TOKEN:
        print("WARNING: MCP_API_TOKEN is not set. Server is running without authentication.")
    if not RENDER_API_KEY:
        print("WARNING: RENDER_API_KEY is not set. run_code calls to Workflows will fail.")
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(create_app(), host="0.0.0.0", port=port)
