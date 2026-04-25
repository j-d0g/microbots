"""Knowledge-graph MCP server module.

The MCP server used to live in `app/services/kg_mcp/` as its own deployable.
It's now part of the unified app and mounted at `/mcp` from `app/main.py`.
Tool logic lives in `tools.py`, SurrealQL in `queries.py`, FastMCP construction
in `server.py`.
"""

from app.mcp.server import build_mcp_server, build_mcp_asgi

__all__ = ["build_mcp_server", "build_mcp_asgi"]
