"""MCP server module — KG FastMCP instance mounted by ``app/main.py``.

  * Knowledge-graph MCP at ``/mcp`` — ``server.py`` + ``tools.py``

The instance has its own lifespan; ``app/main.py`` forwards it via
``contextlib.AsyncExitStack`` so tools stay live.
"""

from app.mcp.server import build_mcp_asgi, build_mcp_server

__all__ = [
    "build_mcp_server",
    "build_mcp_asgi",
]
