"""FastMCP server factory.

Produces a single, lazily-constructed `FastMCP` instance and an ASGI app
suitable for mounting under a FastAPI parent via `app.mount("/mcp", …)`.

We disable FastMCP's DNS-rebinding protection — it auto-enables when the
construction host is 127.0.0.1, but we're a public Render service reached
via `*.onrender.com`.
"""

from __future__ import annotations

from functools import lru_cache

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from app.mcp.tools import register_tools


@lru_cache(maxsize=1)
def build_mcp_server() -> FastMCP:
    """Return a singleton FastMCP instance with all tools registered.

    ``streamable_http_path='/'`` is deliberate: this app is mounted at ``/mcp``
    inside FastAPI, so FastMCP's internal route needs to be at ``/`` to avoid
    the full path becoming ``/mcp/mcp``.
    """
    mcp = FastMCP(
        "microbots_kg",
        streamable_http_path="/",
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=False,
        ),
    )
    register_tools(mcp)
    return mcp


def build_mcp_asgi():
    """Return the Starlette ASGI sub-app FastAPI will mount at ``/mcp``.

    The returned app carries its own lifespan that initialises the streamable
    HTTP session manager — the parent FastAPI app must forward that lifespan,
    see ``app/main.py``.
    """
    return build_mcp_server().streamable_http_app()
