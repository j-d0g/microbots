"""FastAPI app for the SurrealDB-backed knowledge graph and Composio API.

    /api/health              liveness + downstream status (surreal, composio)
    /api/composio/*          OAuth flow for the frontend (connect/connections/toolkits)
    /api/kg/*                knowledge graph API

"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

from app.routes import api_composio, api_health, api_kg
from app.services.composio import ComposioNotConfigured
from microbots import (  # noqa: E402  (env must load first)
    instrument_fastapi,
    instrument_httpx,
    setup_logging,
)

# Configure Logfire BEFORE FastAPI is created so the ``instrument_fastapi``
# call below has a configured exporter to attach to. ``setup_logging`` also
# routes stdlib ``logging`` records through Logfire, so the existing
# ``logger.info`` call sites keep working — they just gain a remote sink.
setup_logging()
instrument_httpx()

logger = logging.getLogger("microbots")


def create_app() -> FastAPI:
    """Build the knowledge graph and Composio API."""
    app = FastAPI(
        title="microbots",
        version="1.0.0",
        description="SurrealDB-backed knowledge graph and Composio OAuth API.",
    )

    @app.exception_handler(ComposioNotConfigured)
    async def composio_not_configured(
        _: Request, __: ComposioNotConfigured
    ) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"error": "composio not configured"},
        )

    # CORS — open for the hackathon so any frontend dev can hit it.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register REST routers.
    app.include_router(api_health.router, prefix="/api")
    app.include_router(api_composio.router, prefix="/api")
    app.include_router(api_kg.router, prefix="/api")

    instrument_fastapi(app)

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "0.0.0.0")
    logger.info("starting microbots on http://%s:%d", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")
