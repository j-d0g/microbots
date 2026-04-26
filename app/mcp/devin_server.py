"""FastMCP server factory for the Devin tools.

Mirrors ``server.py`` but for the Devin v1 API surface. Mounted at ``/mcp/devin``
from ``app/main.py``; planner/monitor agents (pydantic-ai) connect to that URL
and call ``devin_*`` tools directly.

Kept as a separate FastMCP instance — and therefore a separate mount path —
on purpose: KG + Devin have nothing to share, and isolating them makes it
trivial to disable / version-bump one without touching the other.
"""

from __future__ import annotations

from functools import lru_cache

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from app.mcp.devin_tools import register_devin_tools


@lru_cache(maxsize=1)
def build_devin_mcp_server() -> FastMCP:
    """Singleton FastMCP instance with every ``devin_*`` tool registered.

    ``streamable_http_path='/'`` is deliberate: this app is mounted at
    ``/mcp/devin`` inside FastAPI, so FastMCP's internal route needs to be at
    ``/`` to avoid the full path becoming ``/mcp/devin/mcp``.
    """
    mcp = FastMCP(
        "microbots_devin",
        streamable_http_path="/",
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=False,
        ),
    )
    register_devin_tools(mcp)
    return mcp


def build_devin_mcp_asgi():
    """Return the Starlette ASGI sub-app FastAPI will mount at ``/mcp/devin``."""
    return build_devin_mcp_server().streamable_http_app()
