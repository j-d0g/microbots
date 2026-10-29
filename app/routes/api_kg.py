"""/api/kg/* — REST endpoints for the knowledge graph."""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from app.services import kg_writes
from app.services import kg_queries as Q
from app.services.surreal import q, q_one, session

router = APIRouter(prefix="/kg", tags=["knowledge-graph"])


def _name_match_distance(name: str, query: str) -> int | None:
    query_tokens = set(re.findall(r"[a-z0-9]+", query.casefold()))
    name_tokens = set(re.findall(r"[a-z0-9]+", name.casefold()))
    if query_tokens and query_tokens <= name_tokens:
        return len(name_tokens - query_tokens)
    return None


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
async def entities_by_type(entity_type: str | None = Query(None, min_length=1)) -> list[dict[str, Any]]:
    async with session() as s:
        if entity_type is None:
            return await q(s, Q.Q_ENTITIES_ALL)
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


@router.get("/search")
async def search_knowledge_graph(
    query: str = Query(..., min_length=1),
    scope: Literal["memories", "entities", "workflows", "all"] = Query("all"),
    limit: int = Query(5, ge=1, le=20),
) -> dict[str, Any]:
    term = query.strip()
    if not term:
        raise HTTPException(status_code=422, detail="query must not be blank")

    results: list[dict[str, Any]] = []
    params = {"query": term, "limit": limit}
    async with session() as s:
        if scope in ("memories", "all"):
            for row in await q(s, Q.Q_SEARCH_MEMORIES, params):
                results.append({
                    "kind": "memories",
                    "id": str(row["id"]),
                    "focus": str(row["id"]),
                    "snippet": row.get("content", ""),
                    "score": float(row.get("confidence", 0)),
                })
        if scope in ("entities", "all"):
            for row in await q(s, Q.Q_SEARCH_ENTITIES, params):
                results.append({
                    "kind": "entities",
                    "id": str(row["id"]),
                    "focus": str(row["id"]),
                    "name": row.get("name", ""),
                    "snippet": row.get("description") or row.get("name", ""),
                    "score": 0.5,
                    "_name_match_distance": _name_match_distance(
                        row.get("name", ""), term
                    ),
                })
        if scope in ("workflows", "all"):
            for row in await q(s, Q.Q_SEARCH_WORKFLOWS, params):
                results.append({
                    "kind": "workflows",
                    "id": str(row.get("slug") or row["id"]),
                    "focus": str(row.get("slug") or row["id"]),
                    "name": row.get("name", ""),
                    "snippet": row.get("description", ""),
                    "score": 0.5,
                    "_name_match_distance": _name_match_distance(
                        row.get("name", ""), term
                    ),
                })
        if scope == "all":
            for row in await q(s, Q.Q_SEARCH_INTEGRATIONS, params):
                connections = (row.get("connections") or []) + (
                    row.get("incoming_connections") or []
                )
                results.append({
                    "kind": "integrations",
                    "id": str(row.get("slug", "")),
                    "focus": str(row.get("slug", "")),
                    "name": row.get("name", ""),
                    "connections": connections,
                    "snippet": ", ".join(
                        str(connection.get("name") or connection.get("slug") or "")
                        for connection in connections
                    ),
                    "score": 0.9,
                    "_name_match_distance": _name_match_distance(
                        row.get("name", ""), term
                    ),
                })

    results.sort(
        key=lambda result: (
            result.get("_name_match_distance") is None,
            result.get("_name_match_distance") or 0,
            -result["score"],
            result["kind"],
            result["id"],
        )
    )
    for result in results:
        result.pop("_name_match_distance", None)
    return {"query": term, "scope": scope, "count": len(results), "results": results}


@router.get("/skills")
async def skills_all(min_strength: int = Query(1, ge=1, le=10)) -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_SKILLS_ALL, {"min_strength": min_strength})


@router.get("/workflows")
async def workflows_all() -> list[dict[str, Any]]:
    async with session() as s:
        return await q(s, Q.Q_WORKFLOWS_ALL)


@router.get("/chats")
async def chats_list(
    source_type: str = Query("ui_chat", min_length=1),
    limit: int = Query(50, ge=1, le=200),
) -> list[dict[str, Any]]:
    """Return recent chat messages, newest first."""
    async with session() as s:
        return await q(s, Q.Q_CHATS_BY_SOURCE, {"source_type": source_type, "limit": limit})


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


# ─── Write endpoints (REST mirror of the MCP write tools) ────────────────


class AddMemoryBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    content: str = Field(..., min_length=1)
    memory_type: str = Field(default="fact")
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)
    source: Optional[str] = None
    tags: Optional[list[str]] = None
    chat_id: Optional[str] = None
    about_entity_id: Optional[str] = None
    about_integration_slug: Optional[str] = None


@router.post("/memories", status_code=201)
async def post_memory(body: AddMemoryBody) -> dict[str, Any]:
    """Persist a memory the agent / user has learned. Idempotent on content."""
    return await kg_writes.add_memory(**body.model_dump(exclude_none=False))


class UpsertEntityBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(..., min_length=1)
    entity_type: str = Field(..., min_length=1)
    description: Optional[str] = None
    aliases: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    appears_in_integration: Optional[str] = None
    appears_in_handle: Optional[str] = None
    appears_in_role: Optional[str] = None


@router.post("/entities", status_code=201)
async def post_entity(body: UpsertEntityBody) -> dict[str, Any]:
    """Add-or-merge an entity by ``(entity_type, name)``."""
    return await kg_writes.upsert_entity(**body.model_dump(exclude_none=False))


class UpsertSkillBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    slug: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    steps: Optional[list[str]] = None
    frequency: Optional[str] = None
    strength_increment: int = Field(default=1, ge=1, le=10)
    tags: Optional[list[str]] = None
    uses_integrations: Optional[list[str]] = None


@router.post("/skills", status_code=201)
async def post_skill(body: UpsertSkillBody) -> dict[str, Any]:
    """Add a new skill or strengthen an existing one (atomic increment)."""
    return await kg_writes.upsert_skill(**body.model_dump(exclude_none=False))


class WorkflowSkillStepBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(..., min_length=1)
    step_order: int = Field(..., ge=0)


class UpsertWorkflowBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    slug: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    trigger: Optional[str] = None
    outcome: Optional[str] = None
    frequency: Optional[str] = None
    tags: Optional[list[str]] = None
    skill_chain: Optional[list[WorkflowSkillStepBody]] = None


@router.post("/workflows", status_code=201)
async def post_workflow(body: UpsertWorkflowBody) -> dict[str, Any]:
    """Add or update a workflow; replaces the skill_chain when provided."""
    payload = body.model_dump(exclude_none=False)
    if payload.get("skill_chain") is not None:
        payload["skill_chain"] = [s.model_dump() for s in body.skill_chain or []]
    return await kg_writes.upsert_workflow(**payload)


class AddChatMentionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(..., description="Entity record id, e.g. 'entity:martin'.")
    mention_type: str = Field(default="subject")


class AddChatBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    content: str = Field(..., min_length=1)
    source_type: str = Field(..., min_length=1)
    source_id: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    signal_level: str = Field(default="mid", pattern=r"^(low|mid|high)$")
    occurred_at: Optional[str] = None
    from_integration: Optional[str] = None
    mentions: Optional[list[AddChatMentionBody]] = None


@router.post("/chats", status_code=201)
async def post_chat(body: AddChatBody) -> dict[str, Any]:
    """Persist a chat / observation."""
    payload = body.model_dump(exclude_none=False)
    if payload.get("mentions") is not None:
        payload["mentions"] = [m.model_dump() for m in body.mentions or []]
    return await kg_writes.add_chat(**payload)


class WriteWikiPageBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    content: str = Field(...)
    rationale: Optional[str] = None


@router.put("/wiki/{path:path}")
async def put_wiki_page(path: str, body: WriteWikiPageBody) -> dict[str, Any]:
    """Diff-update a wiki page; logs a revision when the content changes."""
    return await kg_writes.write_wiki_page(
        path=path, content=body.content, rationale=body.rationale,
    )


class UpdateUserProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = None
    role: Optional[str] = None
    goals: Optional[list[str]] = None
    preferences: Optional[dict] = None
    context_window: Optional[int] = Field(default=None, ge=512, le=200_000)


@router.patch("/user")
async def patch_user(body: UpdateUserProfileBody) -> dict[str, Any]:
    """Patch the singleton user_profile:default record."""
    return await kg_writes.update_user_profile(**body.model_dump(exclude_none=True))
