"""/api/kg/* — REST mirror of the MCP tools.

The MCP server (mounted at ``/mcp``) is ideal for LLM agents but awkward for
vanilla JS / curl. This module exposes the same queries as plain JSON so a
frontend dev can hit them with ``fetch`` and never think about MCP framing.

Every handler re-uses ``app.services.surreal.q`` so the REST and MCP layers
always return the exact same data.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.mcp import queries as Q
from app.services.surreal import q, q_one, session

router = APIRouter(prefix="/kg", tags=["knowledge-graph"])


@router.get("/integrations")
async def integrations_overview() -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_INTEGRATIONS_OVERVIEW)


@router.get("/integrations/{slug}")
async def integration_detail(slug: str, limit: int = Query(10, ge=1, le=100)) -> dict[str, Any]:
    async with session() as s:
        row = await q_one(s, Q.Q_INTEGRATION_DETAIL, {"slug": slug, "limit": limit})
        if not row:
            raise HTTPException(status_code=404, detail=f"integration {slug!r} not found")
        return row


@router.get("/entity-types")
async def entity_types() -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_ENTITY_TYPES)


@router.get("/entities")
async def entities_by_type(entity_type: str = Query(..., min_length=1)) -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_ENTITIES_BY_TYPE, {"entity_type": entity_type})


@router.get("/entities/{id}")
async def entity_detail(id: str) -> dict[str, Any]:
    async with session() as s:
        row = await q_one(s, Q.Q_ENTITY_DETAIL, {"id": id})
        if not row:
            raise HTTPException(status_code=404, detail=f"entity {id!r} not found")
        return row


@router.get("/memories")
async def memories_top(
    by: str = Query("confidence", pattern=r"^(confidence|recency)$"),
    limit: int = Query(20, ge=1, le=200),
) -> list[dict[str, Any]]:
    order_field = "confidence" if by == "confidence" else "created_at"
    async with session() as s:
        return await q(s, Q.Q_MEMORIES_TOP.replace("{order_field}", order_field), {"limit": limit})


@router.get("/skills")
async def skills_all(min_strength: int = Query(1, ge=1, le=10)) -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_SKILLS_ALL, {"min_strength": min_strength})


@router.get("/workflows")
async def workflows_all() -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_WORKFLOWS_ALL)


@router.get("/chats/summary")
async def chats_summary() -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_CHATS_SUMMARY)


@router.get("/user")
async def user_profile() -> dict[str, Any]:
    async with session() as s:
        return await q_one(s, Q.Q_USER_PROFILE)


@router.get("/wiki")
async def wiki_tree() -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_WIKI_TREE)


@router.get("/wiki/{path:path}")
async def wiki_page(path: str) -> dict[str, Any]:
    async with session() as s:
        row = await q_one(s, Q.Q_WIKI_PAGE, {"path": path})
        if not row:
            raise HTTPException(status_code=404, detail=f"wiki page {path!r} not found")
        return row
