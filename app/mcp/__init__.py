"""MCP server module — two FastMCP instances mounted by ``app/main.py``.

  * Knowledge-graph MCP at ``/mcp``       — ``server.py`` + ``tools.py``
  * Devin code-agent MCP at ``/mcp/devin`` — ``devin_server.py`` + ``devin_tools.py``

Each instance has its own lifespan; ``app/main.py`` forwards both via
``contextlib.AsyncExitStack`` so tools on either path stay live.
"""

from app.mcp.devin_server import build_devin_mcp_asgi, build_devin_mcp_server
from app.mcp.server import build_mcp_asgi, build_mcp_server

__all__ = [
    "build_mcp_server",
    "build_mcp_asgi",
    "build_devin_mcp_server",
    "build_devin_mcp_asgi",
]
