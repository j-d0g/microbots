"""/api/health — a single probe covering both downstream dependencies.

Returns 200 as long as the service itself is up. Individual sub-statuses
("surreal", "composio") report the health of each dependency so the frontend
can render a degraded state without relying on HTTP error codes.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter

from app.services.surreal import session

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


async def _check_surreal() -> dict[str, Any]:
    try:
        async with session() as s:
            info = await s.query("INFO FOR DB;")
            if isinstance(info, list) and info:
                info = info[0]
            tables = list((info or {}).get("tables", {}).keys())
        return {"ok": True, "table_count": len(tables)}
    except Exception as e:  # noqa: BLE001
        logger.exception("surreal health check failed")
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


async def _check_composio() -> dict[str, Any]:
    if not os.getenv("COMPOSIO_API_KEY"):
        return {"ok": False, "error": "COMPOSIO_API_KEY not set"}
    try:
        from app.services.composio import get_composio_service
        svc = get_composio_service()
        toolkits = await svc.list_toolkits()
        return {"ok": True, "toolkit_count": len(toolkits)}
    except Exception as e:  # noqa: BLE001
        logger.exception("composio health check failed")
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


@router.get("/health")
async def health() -> dict[str, Any]:
    """Service + downstream liveness."""
    surreal_info = await _check_surreal()
    composio_info = await _check_composio()
    return {
        "status": "ok",
        "service": "microbots",
        "surreal": surreal_info,
        "composio": composio_info,
    }
