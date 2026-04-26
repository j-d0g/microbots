"""Phase-0 MCP server skeleton.

Minimal FastMCP app with bearer-token auth and a single `ping` tool.
Exists to verify the harness loop end-to-end before adding the real
P1 tool surface (consult_docs, search_templates, run_code, ...).
"""

import hmac
import os
import time

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

MCP_API_TOKEN = os.environ.get("MCP_API_TOKEN")
RENDER_EXTERNAL_HOSTNAME = os.environ.get("RENDER_EXTERNAL_HOSTNAME")

mcp = FastMCP(
    "microbot-harness-mcp",
    stateless_http=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=bool(RENDER_EXTERNAL_HOSTNAME),
        allowed_hosts=[RENDER_EXTERNAL_HOSTNAME] if RENDER_EXTERNAL_HOSTNAME else [],
    ),
)


@mcp.tool()
def ping() -> dict:
    """Liveness probe. Returns the server time so callers can confirm round-trip."""
    return {"status": "ok", "server_time": time.time()}


@mcp.custom_route("/health", methods=["GET"])
async def health(request: Request) -> Response:
    return JSONResponse({"status": "ok"})


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
    app = mcp.streamable_http_app()
    if MCP_API_TOKEN:
        app.add_middleware(BearerAuthMiddleware)
    return app


if __name__ == "__main__":
    import uvicorn

    if not MCP_API_TOKEN:
        print("WARNING: MCP_API_TOKEN is not set. Server is running without authentication.")
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(create_app(), host="0.0.0.0", port=port)
