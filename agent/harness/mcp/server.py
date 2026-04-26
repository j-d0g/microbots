"""MCP server for the microbot harness.

Exposes 4 tools to the chat agent:
  - run_code     — executes Python via Render Workflows run_user_code task
  - find_examples — substring search over templates/index.json
  - save_workflow — writes code to saved/<name>.py, returns mock URL
  - ask_user     — schema-only; resolved by the frontend (client-side tool)
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


@mcp.tool()
def save_workflow(name: str, code: str) -> dict:
    """Persist a Python snippet as a named workflow.

    Writes to saved/<slug>.py and returns a stable URL. Use when the user
    asks to save / promote / publish work.
    """
    slug = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    if not slug:
        return {"error": "invalid name (must produce a non-empty slug)"}
    target = SAVED_DIR / f"{slug}.py"
    target.write_text(code, encoding="utf-8")
    return {
        "url": f"https://example.com/workflows/{slug}",
        "saved_to": str(target),
        "bytes": len(code.encode("utf-8")),
    }


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
