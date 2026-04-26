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
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field

from app.mcp import queries as Q
from app.services import kg_writes
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


# ─── Write input models ───────────────────────────────────────────────────


class AddMemoryInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    content: str = Field(..., description="The fact / preference / decision to remember.", min_length=1)
    memory_type: str = Field(default="fact", description="One of: fact, preference, action_pattern, decision, observation.")
    confidence: float = Field(default=0.7, description="0.0 (low) - 1.0 (certain).", ge=0.0, le=1.0)
    source: Optional[str] = Field(default=None, description="Where this came from (e.g. 'slack', 'agent-inference').")
    tags: Optional[list[str]] = Field(default=None, description="Free-form tags.")
    chat_id: Optional[str] = Field(default=None, description="Optional source chat record id (e.g. 'chat:abc'); creates chat_yields edge.")
    about_entity_id: Optional[str] = Field(default=None, description="Optional entity this memory is about (e.g. 'entity:martin').")
    about_integration_slug: Optional[str] = Field(default=None, description="Optional integration this memory is about (e.g. 'slack').")


class UpsertEntityInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(..., min_length=1, description="Display name.")
    entity_type: str = Field(..., description="e.g. 'person', 'organisation', 'project'.", min_length=1)
    description: Optional[str] = None
    aliases: Optional[list[str]] = Field(default=None, description="Alternative handles or names.")
    tags: Optional[list[str]] = None
    appears_in_integration: Optional[str] = Field(default=None, description="Integration slug; also creates appears_in edge.")
    appears_in_handle: Optional[str] = None
    appears_in_role: Optional[str] = None


class UpsertSkillInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    slug: str = Field(..., min_length=1, description="Stable slug used as the record id.")
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    steps: Optional[list[str]] = None
    frequency: Optional[str] = None
    strength_increment: int = Field(default=1, description="Added to existing strength on each call.", ge=1, le=10)
    tags: Optional[list[str]] = None
    uses_integrations: Optional[list[str]] = Field(default=None, description="Integration slugs; creates skill_uses edges.")


class WorkflowSkillStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(..., min_length=1)
    step_order: int = Field(..., ge=0)


class UpsertWorkflowInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    slug: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    trigger: Optional[str] = None
    outcome: Optional[str] = None
    frequency: Optional[str] = None
    tags: Optional[list[str]] = None
    skill_chain: Optional[list[WorkflowSkillStep]] = Field(default=None, description="Replaces existing chain when provided.")


class AddChatMention(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(..., description="Entity record id, e.g. 'entity:martin'.")
    mention_type: str = Field(default="subject")


class AddChatInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    content: str = Field(..., min_length=1)
    source_type: str = Field(..., min_length=1, description="e.g. 'slack_thread', 'github_issue', 'agent_observation'.")
    source_id: Optional[str] = Field(default=None, description="Dedup key; same source_id upserts the same row.")
    title: Optional[str] = None
    summary: Optional[str] = None
    signal_level: str = Field(default="mid", pattern=r"^(low|mid|high)$")
    occurred_at: Optional[str] = Field(default=None, description="ISO-8601 timestamp.")
    from_integration: Optional[str] = Field(default=None, description="Integration slug; creates chat_from edge.")
    mentions: Optional[list[AddChatMention]] = None


class WriteWikiPageInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    path: str = Field(..., min_length=1)
    content: str = Field(...)
    rationale: Optional[str] = Field(default=None, description="Logged into wiki_page_revision when content changes.")


class UpdateUserProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = None
    role: Optional[str] = None
    goals: Optional[list[str]] = Field(default=None, description="Replaces the existing goals array.")
    preferences: Optional[dict] = Field(default=None, description="Merged into existing preferences object.")
    context_window: Optional[int] = Field(default=None, ge=512, le=200_000)


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

    # ── Write tools ─────────────────────────────────────────────────────
    # Annotations:
    #   readOnlyHint=False  — these mutate the graph
    #   destructiveHint=False — no deletes; everything is upsert / append
    #   idempotentHint=False — strength increments accumulate; calling twice
    #                          changes state (but content-hashed memories
    #                          are idempotent on identical content).
    WRITE = {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}

    @mcp.tool(name="kg_add_memory", annotations={**WRITE, "title": "Persist a memory"})
    async def kg_add_memory(params: AddMemoryInput) -> str:
        """Persist a high-signal memory the agent has learned.

        Memories are deduplicated by content hash, so calling this twice
        with the same ``content`` updates the existing row rather than
        creating a duplicate. Pass ``chat_id``, ``about_entity_id`` or
        ``about_integration_slug`` to also create the relevant edge.
        """
        result = await kg_writes.add_memory(**params.model_dump(exclude_none=False))
        return dumps(result)

    @mcp.tool(name="kg_upsert_entity", annotations={**WRITE, "title": "Add or merge an entity"})
    async def kg_upsert_entity(params: UpsertEntityInput) -> str:
        """Add or merge a person / organisation / project / concept.

        Identity is ``(entity_type, name)``. Use ``aliases`` to remember
        alternative spellings or handles. Pass
        ``appears_in_integration`` to also create the ``appears_in`` edge.
        """
        result = await kg_writes.upsert_entity(**params.model_dump(exclude_none=False))
        return dumps(result)

    @mcp.tool(name="kg_upsert_skill", annotations={**WRITE, "title": "Add or strengthen a skill"})
    async def kg_upsert_skill(params: UpsertSkillInput) -> str:
        """Add a new skill or strengthen an existing one.

        ``slug`` is the stable identifier — re-calling with the same slug
        updates the row. ``strength_increment`` is *added* to the existing
        strength so each observation makes the skill more robust.
        """
        result = await kg_writes.upsert_skill(**params.model_dump(exclude_none=False))
        return dumps(result)

    @mcp.tool(name="kg_upsert_workflow", annotations={**WRITE, "title": "Add or update a workflow"})
    async def kg_upsert_workflow(params: UpsertWorkflowInput) -> str:
        """Add or update a multi-step workflow.

        Provide ``skill_chain`` as ``[{"slug": "...", "step_order": 1}, …]``.
        When supplied, the chain *replaces* any existing chain for this
        workflow; passing ``None`` leaves the chain untouched.
        """
        payload = params.model_dump(exclude_none=False)
        # Convert nested Pydantic models to plain dicts for the writer.
        if payload.get("skill_chain") is not None:
            payload["skill_chain"] = [
                step.model_dump() if hasattr(step, "model_dump") else step
                for step in params.skill_chain or []
            ]
        result = await kg_writes.upsert_workflow(**payload)
        return dumps(result)

    @mcp.tool(name="kg_add_chat", annotations={**WRITE, "title": "Persist a chat / observation"})
    async def kg_add_chat(params: AddChatInput) -> str:
        """Record a chat message, observation, or event.

        Use ``source_id`` for dedup — re-calling with the same id upserts.
        ``mentions`` creates ``chat_mentions`` edges to entities.
        """
        payload = params.model_dump(exclude_none=False)
        if payload.get("mentions") is not None:
            payload["mentions"] = [
                m.model_dump() if hasattr(m, "model_dump") else m
                for m in params.mentions or []
            ]
        result = await kg_writes.add_chat(**payload)
        return dumps(result)

    @mcp.tool(name="kg_write_wiki_page", annotations={**WRITE, "title": "Write a wiki page"})
    async def kg_write_wiki_page(params: WriteWikiPageInput) -> str:
        """Diff-update a wiki page; logs a revision when the content changes.

        ``path`` is the unique key (e.g. 'memories/agents.md'). When the new
        content matches the existing content the call is a no-op.
        """
        result = await kg_writes.write_wiki_page(**params.model_dump(exclude_none=False))
        return dumps(result)

    @mcp.tool(name="kg_update_user_profile", annotations={**WRITE, "title": "Patch the user profile"})
    async def kg_update_user_profile(params: UpdateUserProfileInput) -> str:
        """Patch the singleton ``user_profile:default`` record.

        Only the fields you pass are updated; the rest are left untouched.
        ``preferences`` is *merged* into the existing object, ``goals`` is
        *replaced* wholesale.
        """
        result = await kg_writes.update_user_profile(**params.model_dump(exclude_none=True))
        return dumps(result)

    # ── End of write tools ───────────────────────────────────────────────

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
