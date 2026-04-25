"""MCP tools — thin wrappers around the SurrealQL queries.

Each tool:
  1. opens a SurrealDB session (fresh per request, see rationale in services/surreal.py)
  2. runs the named query
  3. returns a JSON-encoded string (FastMCP's native tool return type)

Ported from the former `app/services/kg_mcp/main.py`. The input Pydantic
models and tool annotations are unchanged so any existing MCP client keeps
working against the new unified URL.
"""

from __future__ import annotations

import logging
from typing import Any

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field

from app.mcp import queries as Q
from app.services.surreal import dumps, q, q_one, session

logger = logging.getLogger(__name__)


# ─── Pydantic input models ────────────────────────────────────────────────

class IntegrationDetailInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    slug: str = Field(..., description="Integration slug (slack/github/linear/gmail/notion/perplexity).", min_length=1)
    limit: int = Field(default=10, description="Max top-memories to return.", ge=1, le=100)


class EntitiesByTypeInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    entity_type: str = Field(..., description="Entity type — e.g. 'person', 'organisation', 'project'.", min_length=1)


class EntityDetailInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    id: str = Field(..., description="Full entity record id, e.g. 'entity:martin'.", min_length=1)


class MemoriesTopInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    by: str = Field(default="confidence", description="Sort order: 'confidence' (default) or 'recency'.",
                    pattern=r"^(confidence|recency)$")
    limit: int = Field(default=20, description="Max memories to return.", ge=1, le=200)


class SkillsAllInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min_strength: int = Field(default=1, description="Minimum strength threshold.", ge=1, le=10)


class WikiPageInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    path: str = Field(..., description="Wiki page path, e.g. 'user.md'.", min_length=1)


# ─── Tool registration ────────────────────────────────────────────────────

def register_tools(mcp: FastMCP) -> None:
    """Attach every @mcp.tool() to the given FastMCP instance."""

    RO = {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}

    @mcp.tool(name="kg_integrations_overview", annotations={**RO, "title": "List all integrations"})
    async def kg_integrations_overview() -> str:
        """List every integration the user has connected."""
        async with session() as s:
            return dumps(await q(s, Q.Q_INTEGRATIONS_OVERVIEW))

    @mcp.tool(name="kg_integration_detail", annotations={**RO, "title": "Inspect one integration"})
    async def kg_integration_detail(params: IntegrationDetailInput) -> str:
        """Deep info for one integration: entities + top memories + skills."""
        async with session() as s:
            row = await q_one(s, Q.Q_INTEGRATION_DETAIL, {"slug": params.slug, "limit": params.limit})
            return dumps(row)

    @mcp.tool(name="kg_entities_by_type", annotations={**RO, "title": "List entities of a given type"})
    async def kg_entities_by_type(params: EntitiesByTypeInput) -> str:
        """All entities of a type with chat-mention counts."""
        async with session() as s:
            return dumps(await q(s, Q.Q_ENTITIES_BY_TYPE, {"entity_type": params.entity_type}))

    @mcp.tool(name="kg_entity_detail", annotations={**RO, "title": "Inspect one entity"})
    async def kg_entity_detail(params: EntityDetailInput) -> str:
        """Full info for one entity: integrations + recent chat mentions."""
        async with session() as s:
            return dumps(await q_one(s, Q.Q_ENTITY_DETAIL, {"id": params.id}))

    @mcp.tool(name="kg_memories_top", annotations={**RO, "title": "Top memories"})
    async def kg_memories_top(params: MemoriesTopInput) -> str:
        """Top memories sorted by confidence (default) or recency."""
        order_field = "confidence" if params.by == "confidence" else "created_at"
        async with session() as s:
            return dumps(await q(s, Q.Q_MEMORIES_TOP.replace("{order_field}", order_field),
                                 {"limit": params.limit}))

    @mcp.tool(name="kg_skills_all", annotations={**RO, "title": "List all skills"})
    async def kg_skills_all(params: SkillsAllInput) -> str:
        """All skills the user has demonstrated, with their integrations."""
        async with session() as s:
            return dumps(await q(s, Q.Q_SKILLS_ALL, {"min_strength": params.min_strength}))

    @mcp.tool(name="kg_workflows_all", annotations={**RO, "title": "List all workflows"})
    async def kg_workflows_all() -> str:
        """All multi-step workflows with their ordered skill chain."""
        async with session() as s:
            return dumps(await q(s, Q.Q_WORKFLOWS_ALL))

    @mcp.tool(name="kg_chats_summary", annotations={**RO, "title": "Chat counts per integration"})
    async def kg_chats_summary() -> str:
        """Chat counts grouped by integration and signal level."""
        async with session() as s:
            return dumps(await q(s, Q.Q_CHATS_SUMMARY))

    @mcp.tool(name="kg_user_profile", annotations={**RO, "title": "User profile + counts"})
    async def kg_user_profile() -> str:
        """The root user_profile node + aggregate counts across the graph."""
        async with session() as s:
            return dumps(await q_one(s, Q.Q_USER_PROFILE))

    @mcp.tool(name="kg_entity_types", annotations={**RO, "title": "Distinct entity types"})
    async def kg_entity_types() -> str:
        """All distinct entity_type values with their counts."""
        async with session() as s:
            return dumps(await q(s, Q.Q_ENTITY_TYPES))

    @mcp.tool(name="kg_wiki_page", annotations={**RO, "title": "Read one wiki page"})
    async def kg_wiki_page(params: WikiPageInput) -> str:
        """Read one wiki page (the agent-generated markdown layer)."""
        async with session() as s:
            return dumps(await q_one(s, Q.Q_WIKI_PAGE, {"path": params.path}))

    @mcp.tool(name="kg_wiki_tree", annotations={**RO, "title": "List all wiki pages"})
    async def kg_wiki_tree() -> str:
        """List every wiki page (path + depth + layer) without contents."""
        async with session() as s:
            return dumps(await q(s, Q.Q_WIKI_TREE))

    @mcp.tool(name="kg_health", annotations={**RO, "title": "Health check"})
    async def kg_health() -> str:
        """Sanity-check the SurrealDB connection."""
        import os
        async with session() as s:
            info = await s.query("INFO FOR DB;")
            if isinstance(info, list) and info:
                info = info[0]
            tables = list((info or {}).get("tables", {}).keys())
            return dumps({
                "status": "ok",
                "ns": os.getenv("SURREAL_NS", "microbots"),
                "db": os.getenv("SURREAL_DB", "memory"),
                "table_count": len(tables),
            })
