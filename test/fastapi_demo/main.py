"""Tiny FastAPI demo app used to smoke-test the render_sdk deploy pipeline.

It serves a single styled HTML page at `/` and a JSON `/health` endpoint.
The PORT env var (set by Render at runtime) is honoured; defaults to 8080
locally so the same container image works in both environments.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"

app = FastAPI(title="Microbots Render SDK Demo", version="0.1.0")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    """Render the landing page so a human can eyeball the deploy."""
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "service_name": os.environ.get("SERVICE_NAME", "fastapi-demo"),
            "deployed_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "region": os.environ.get("RENDER_REGION", "local"),
        },
    )


@app.get("/health")
async def health() -> JSONResponse:
    """Lightweight health probe — used by Render and by the SDK polling loop."""
    return JSONResponse({"status": "ok", "service": "fastapi-demo"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8800"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
