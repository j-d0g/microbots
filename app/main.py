"""Unified FastAPI app — MCP + REST + Composio OAuth at one URL.

Replaces the standalone `app/services/kg_mcp/` deployable. Serves:

    /mcp                     FastMCP streamable-HTTP transport (13 tools)
    /api/health              liveness + downstream status (surreal, composio)
    /api/composio/*          OAuth flow for the frontend (connect/connections/toolkits)
    /api/kg/*                REST mirror of the MCP tools for non-LLM clients

Deployed via `app/deploy.py` → `render_sdk` as a single Render web service.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

from app.mcp import build_mcp_asgi  # noqa: E402  (env must load first)
from app.routes import api_composio, api_health, api_kg

logger = logging.getLogger("microbots")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")


def create_app() -> FastAPI:
    """Build the unified FastAPI application.

    The MCP sub-app has its own lifespan (starts the streamable-HTTP session
    manager). We forward it as the parent app's lifespan so mounting works.
    """
    mcp_asgi = build_mcp_asgi()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async with mcp_asgi.router.lifespan_context(_):
            yield

    app = FastAPI(
        title="microbots",
        version="1.0.0",
        description=(
            "Unified backend: knowledge-graph MCP + REST + per-user Composio OAuth. "
            "See /docs for the REST API; /mcp for the MCP streamable-HTTP endpoint."
        ),
        lifespan=lifespan,
    )

    # CORS — open for the hackathon so any frontend dev can hit it.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Top-level /health for Render's deploy probe (cheap, no downstream checks).
    # Rich liveness with surreal/composio sub-status lives at /api/health.
    @app.get("/health", include_in_schema=False)
    async def _render_health() -> dict[str, str]:
        return {"status": "ok", "service": "microbots"}

    # Mount MCP at /mcp.
    app.mount("/mcp", mcp_asgi)

    # Register REST routers.
    app.include_router(api_health.router, prefix="/api")
    app.include_router(api_composio.router, prefix="/api")
    app.include_router(api_kg.router, prefix="/api")

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "0.0.0.0")
    logger.info("starting microbots on http://%s:%d", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")
