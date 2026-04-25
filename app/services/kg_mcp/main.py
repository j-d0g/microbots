"""Knowledge Graph MCP server.

Exposes the microbots SurrealDB knowledge graph as an MCP toolset. Any MCP
client (pydantic-ai agents, Claude Desktop, Cursor, etc.) can connect to this
server to read integrations, entities, memories, skills, workflows, and the
agent-generated wiki.

Transport: streamable HTTP (binds to ``$PORT`` so Render routes traffic).
Auth:      none (single-tenant for the hackathon).

Each tool is a thin wrapper around a *named* SurrealQL query — no raw SQL
escapes from the client, so the schema acts as the security boundary.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Optional

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, ConfigDict, Field
from surrealdb import AsyncSurreal

load_dotenv()

logger = logging.getLogger("kg_mcp")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

# ─── Config ──────────────────────────────────────────────────────────────────

SURREAL_URL  = os.environ["SURREAL_URL"]
SURREAL_USER = os.environ["SURREAL_USER"]
SURREAL_PASS = os.environ["SURREAL_PASS"]
SURREAL_NS   = os.getenv("SURREAL_NS", "microbots")
SURREAL_DB   = os.getenv("SURREAL_DB", "memory")

# ─── SurrealDB session helper ────────────────────────────────────────────────

@asynccontextmanager
async def session():
    """Open a one-shot SurrealDB session for a single tool call.

    A fresh connection per call is simpler and more resilient than holding
    a long-lived WebSocket — the overhead is ~50–150 ms which is fine for
    interactive agent use. Optimise later if metrics demand it.
    """
    async with AsyncSurreal(SURREAL_URL) as s:
        await s.signin({"username": SURREAL_USER, "password": SURREAL_PASS})
        await s.use(SURREAL_NS, SURREAL_DB)
        yield s


# ─── JSON normalisation ──────────────────────────────────────────────────────
# SurrealDB v3 returns native types (RecordID, datetime) that aren't directly
# JSON-serialisable. FastMCP's validator surfaces this as a confusing
# "Input should be a valid dictionary" error. We normalise once at the
# boundary — everything downstream sees plain dicts/lists/strings.

import datetime as _dt
from decimal import Decimal as _Decimal
from uuid import UUID as _UUID


def _jsonify(obj):
    """Recursively convert Surreal-native types to JSON-safe primitives."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: _jsonify(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonify(x) for x in obj]
    if isinstance(obj, _dt.datetime):
        return obj.isoformat()
    if isinstance(obj, _dt.date):
        return obj.isoformat()
    if isinstance(obj, (_Decimal, _UUID)):
        return str(obj)
    # SurrealDB RecordID, Table, Range, Bytes, etc. all stringify cleanly.
    cls = type(obj).__name__
    if cls in ("RecordID", "RecordIdKey", "Table", "Range", "Bytes", "Future", "Geometry"):
        return str(obj)
    # Fallback for anything else we haven't seen yet — stringify.
    return str(obj)


import json as _json


async def _q(s, surql: str, params: Optional[dict] = None) -> str:
    """Run a query, return JSON-encoded list of rows.

    We return a JSON string (not a list) because FastMCP's response encoder
    re-validates ``list[dict]`` returns through Pydantic, which doesn't know
    how to serialise SurrealDB's ``RecordID`` / ``datetime`` natives. By
    encoding to JSON ourselves with our own normaliser, FastMCP just passes
    the string through as text content.
    """
    rows = await s.query(surql, params or {})
    if rows is None:
        return "[]"
    out = _jsonify(rows)
    if not isinstance(out, list):
        out = [out]
    return _json.dumps(out, indent=2, default=str)


async def _q_one(s, surql: str, params: Optional[dict] = None) -> str:
    """Run a query that should yield a single row; return JSON-encoded row (or {})."""
    rows = await s.query(surql, params or {})
    if rows is None:
        return "{}"
    out = _jsonify(rows)
    if isinstance(out, list):
        out = out[0] if out else {}
    return _json.dumps(out, indent=2, default=str)


# ─── SurrealQL queries (verbatim from knowledge_graph/db/queries.py) ─────────
# Vendoring the strings here keeps the MCP container self-contained — the
# knowledge_graph Python package is the source of truth for the schema, but
# this server doesn't need to import any of its modules.

_Q_INTEGRATIONS_OVERVIEW = """
SELECT
    slug, name, category, frequency, description, user_purpose,
    (SELECT out.slug FROM co_used_with WHERE in = $parent.id) AS co_used_with_slugs
FROM integration ORDER BY slug ASC
"""

# NOTE: SurrealDB v3 does not return values from multi-statement LET/RETURN
# scripts over the WebSocket RPC, so we use a single SELECT with subqueries.
_Q_INTEGRATION_DETAIL = """
SELECT
    *,
    (SELECT * FROM entity WHERE <-appears_in<-(integration WHERE slug = $slug))
        AS entities,
    (SELECT * FROM memory WHERE ->memory_about->(integration WHERE slug = $slug)
        ORDER BY confidence DESC LIMIT $limit)
        AS top_memories,
    (SELECT * FROM skill WHERE ->skill_uses->(integration WHERE slug = $slug))
        AS skills
FROM integration WHERE slug = $slug LIMIT 1
"""

_Q_ENTITIES_BY_TYPE = """
SELECT
    entity_type, name, id, description, aliases, tags,
    count(SELECT 1 FROM chat_mentions WHERE out = $parent.id) AS chat_mention_count
FROM entity
WHERE entity_type = $entity_type
ORDER BY name ASC
"""

_Q_ENTITY_DETAIL = """
SELECT
    *,
    (SELECT out.slug AS integration_slug, handle, role
        FROM appears_in WHERE in = $id) AS appears_in_edges,
    (SELECT in.id AS chat_id, in.title, in.source_type, mention_type
        FROM chat_mentions WHERE out = $id LIMIT 20) AS mentions
FROM entity WHERE id = $id LIMIT 1
"""

_Q_MEMORIES_TOP = """
SELECT * FROM memory ORDER BY {order_field} DESC LIMIT $limit
"""

_Q_SKILLS_ALL = """
SELECT
    id, name, slug, description, steps, frequency, strength, tags,
    array::distinct(
        (SELECT out.slug FROM skill_uses WHERE in = $parent.id).out.slug
    ) AS integrations
FROM skill
WHERE strength >= $min_strength
ORDER BY strength DESC, name ASC
"""

_Q_WORKFLOWS_ALL = """
SELECT
    id, name, slug, description, trigger, outcome, frequency, tags,
    array::distinct(
        (
            SELECT out.slug AS skill_slug, step_order
            FROM workflow_contains_skill
            WHERE in = $parent.id
            ORDER BY step_order ASC
        )
    ) AS skill_chain
FROM workflow ORDER BY name ASC
"""

_Q_CHATS_SUMMARY = """
SELECT out.slug AS integration, signal_level, count() AS count
FROM chat_from
GROUP BY out.slug, signal_level
ORDER BY count DESC
"""

_Q_USER_PROFILE = """
SELECT
    *,
    (SELECT count() AS n FROM chat        GROUP ALL)[0].n ?? 0 AS chat_count,
    (SELECT count() AS n FROM memory      GROUP ALL)[0].n ?? 0 AS memory_count,
    (SELECT count() AS n FROM skill       GROUP ALL)[0].n ?? 0 AS skill_count,
    (SELECT count() AS n FROM workflow    GROUP ALL)[0].n ?? 0 AS workflow_count,
    (SELECT count() AS n FROM entity      GROUP ALL)[0].n ?? 0 AS entity_count,
    (SELECT count() AS n FROM integration GROUP ALL)[0].n ?? 0 AS integration_count
FROM user_profile LIMIT 1
"""

_Q_ENTITY_TYPES = """
SELECT entity_type, count() AS count
FROM entity
GROUP BY entity_type
ORDER BY count DESC
"""

_Q_WIKI_PAGE = """
SELECT path, content, depth, layer FROM wiki_page WHERE path = $path LIMIT 1
"""

_Q_WIKI_TREE = """
SELECT path, depth, layer FROM wiki_page ORDER BY path ASC
"""


# ─── Pydantic input models ───────────────────────────────────────────────────

class IntegrationDetailInput(BaseModel):
    """Args for kg_integration_detail."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    slug: str = Field(..., description="Integration slug — e.g. 'slack', 'github', 'linear'", min_length=1)
    limit: int = Field(default=10, description="Max top-memories to return.", ge=1, le=100)


class EntitiesByTypeInput(BaseModel):
    """Args for kg_entities_by_type."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    entity_type: str = Field(..., description="Entity type — e.g. 'person', 'organisation', 'project'.", min_length=1)


class EntityDetailInput(BaseModel):
    """Args for kg_entity_detail."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    id: str = Field(..., description="Full entity record id, e.g. 'entity:martin'.", min_length=1)


class MemoriesTopInput(BaseModel):
    """Args for kg_memories_top."""
    model_config = ConfigDict(extra="forbid")
    by: str = Field(default="confidence", description="Sort order: 'confidence' (default) or 'recency'.", pattern=r"^(confidence|recency)$")
    limit: int = Field(default=20, description="Max memories to return.", ge=1, le=200)


class SkillsAllInput(BaseModel):
    """Args for kg_skills_all."""
    model_config = ConfigDict(extra="forbid")
    min_strength: int = Field(default=1, description="Minimum strength threshold (skills are scored 1+).", ge=1, le=10)


class WikiPageInput(BaseModel):
    """Args for kg_wiki_page."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    path: str = Field(..., description="Wiki page path, e.g. 'user.md' or 'integrations/slack/agents.md'.", min_length=1)


# ─── Server ──────────────────────────────────────────────────────────────────

# DNS rebinding protection auto-enables when the construction host is
# 127.0.0.1/localhost. We're a public Render service reached via
# `*.onrender.com`, so we pass our own permissive settings to disable it.
mcp = FastMCP(
    "kg_mcp",
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
)


# ─── Tools ───────────────────────────────────────────────────────────────────

@mcp.tool(
    name="kg_integrations_overview",
    annotations={"title": "List all integrations", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_integrations_overview() -> str:
    """List every integration the user has connected.

    Returns one row per tool (Slack, GitHub, Linear, …) with its slug, name,
    category, usage frequency, description, primary purpose, and the slugs of
    other integrations it's commonly co-used with.

    Use this as the *first* call when an agent needs to understand what tools
    the user has available before generating workflow code.
    """
    async with session() as s:
        return await _q(s, _Q_INTEGRATIONS_OVERVIEW)


@mcp.tool(
    name="kg_integration_detail",
    annotations={"title": "Inspect one integration", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_integration_detail(params: IntegrationDetailInput) -> str:
    """Deep info for one integration: entities, top memories, and skills.

    Returns a dict with keys:
      - integration  → full integration row
      - entities     → people / orgs / projects observed in this tool
      - top_memories → memories about this integration (sorted by confidence)
      - skills       → skills that use this integration

    Use after kg_integrations_overview when the agent has picked which
    integration to focus on.
    """
    async with session() as s:
        return await _q_one(s, _Q_INTEGRATION_DETAIL,
                            {"slug": params.slug, "limit": params.limit})


@mcp.tool(
    name="kg_entities_by_type",
    annotations={"title": "List entities of a given type", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_entities_by_type(params: EntitiesByTypeInput) -> str:
    """All entities of a given type with how often they're mentioned in chats.

    Common entity_type values: 'person', 'organisation', 'project', 'product',
    'concept'. Use kg_entity_types() if unsure which types exist.
    """
    async with session() as s:
        return await _q(s, _Q_ENTITIES_BY_TYPE, {"entity_type": params.entity_type})


@mcp.tool(
    name="kg_entity_detail",
    annotations={"title": "Inspect one entity", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_entity_detail(params: EntityDetailInput) -> str:
    """Full info for a single entity: which integrations it appears in, and
    the chats that mention it (latest 20)."""
    async with session() as s:
        return await _q_one(s, _Q_ENTITY_DETAIL, {"id": params.id})


@mcp.tool(
    name="kg_memories_top",
    annotations={"title": "Top memories", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_memories_top(params: MemoriesTopInput) -> str:
    """Top memories sorted by confidence (default) or recency.

    A 'memory' is a high-signal distilled fact the system has learned about
    the user (e.g. "user prefers async-first communication", confidence=0.9).
    These are the strongest priors an agent has when making decisions.
    """
    order_field = "confidence" if params.by == "confidence" else "created_at"
    async with session() as s:
        return await _q(
            s,
            _Q_MEMORIES_TOP.replace("{order_field}", order_field),
            {"limit": params.limit},
        )


@mcp.tool(
    name="kg_skills_all",
    annotations={"title": "List all skills", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_skills_all(params: SkillsAllInput) -> str:
    """All skills the user has demonstrated, with which integrations they use.

    A 'skill' is an atomic repeatable behaviour ('notify-deploy', 'create
    Linear issue from Gmail'). `min_strength=1` returns everything; raise it
    to filter to robustly-observed skills only.
    """
    async with session() as s:
        return await _q(s, _Q_SKILLS_ALL, {"min_strength": params.min_strength})


@mcp.tool(
    name="kg_workflows_all",
    annotations={"title": "List all workflows", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_workflows_all() -> str:
    """All multi-step workflows with their ordered skill chain.

    A 'workflow' chains skills (e.g. 'morning brief': read inbox → triage →
    summarise → post Slack). The skill_chain is ordered by step_order.
    """
    async with session() as s:
        return await _q(s, _Q_WORKFLOWS_ALL)


@mcp.tool(
    name="kg_chats_summary",
    annotations={"title": "Chat counts per integration", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_chats_summary() -> str:
    """Chat counts grouped by integration and signal level.

    Useful for an agent to gauge which integrations are most active and how
    much high-signal traffic exists.
    """
    async with session() as s:
        return await _q(s, _Q_CHATS_SUMMARY)


@mcp.tool(
    name="kg_user_profile",
    annotations={"title": "User profile + counts", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_user_profile() -> str:
    """The root user_profile node + aggregate counts across the graph.

    Always call this first when starting a new agent session — it gives the
    user's name, role, goals, preferences plus a one-shot view of how much
    data the graph contains.
    """
    async with session() as s:
        return await _q_one(s, _Q_USER_PROFILE)


@mcp.tool(
    name="kg_entity_types",
    annotations={"title": "Distinct entity types", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_entity_types() -> str:
    """All distinct entity_type values with their counts."""
    async with session() as s:
        return await _q(s, _Q_ENTITY_TYPES)


@mcp.tool(
    name="kg_wiki_page",
    annotations={"title": "Read one wiki page", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_wiki_page(params: WikiPageInput) -> str:
    """Read one wiki page (the agent-generated markdown layer).

    Path examples: 'user.md', 'integrations/slack/agents.md',
    'memories/agents.md'. Use kg_wiki_tree() to see all available paths.
    """
    async with session() as s:
        return await _q_one(s, _Q_WIKI_PAGE, {"path": params.path})


@mcp.tool(
    name="kg_wiki_tree",
    annotations={"title": "List all wiki pages", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_wiki_tree() -> str:
    """List every wiki page (path + depth + layer) without contents.

    Cheap navigation aid for an agent — it can scan the tree, then call
    kg_wiki_page() only on the pages it actually needs.
    """
    async with session() as s:
        return await _q(s, _Q_WIKI_TREE)


# ─── Health check (mounted by FastMCP automatically, but useful here) ────────

@mcp.tool(
    name="kg_health",
    annotations={"title": "Health check", "readOnlyHint": True, "idempotentHint": True, "openWorldHint": False},
)
async def kg_health() -> str:
    """Sanity-check the SurrealDB connection. Returns server version + table count."""
    async with session() as s:
        info = await s.query("INFO FOR DB;")
        if isinstance(info, list) and info:
            info = info[0]
        tables = list((info or {}).get("tables", {}).keys())
        return _json.dumps({
            "status": "ok",
            "ns": SURREAL_NS,
            "db": SURREAL_DB,
            "table_count": len(tables),
        }, indent=2)


# ─── ASGI app + entrypoint ───────────────────────────────────────────────────
# We wrap FastMCP's Starlette app so we can expose a plain HTTP `/health`
# endpoint *alongside* `/mcp`. Render's deploy health check hits `/health`
# and won't promote the service to live without a 200.

import uvicorn  # noqa: E402  (import ordering kept tidy by group)
from starlette.requests import Request as _StarletteRequest
from starlette.responses import JSONResponse


async def _health_endpoint(request: _StarletteRequest) -> JSONResponse:
    """Render-friendly health probe — 200 OK on every hit."""
    return JSONResponse({"status": "ok", "service": "kg-mcp", "ns": SURREAL_NS, "db": SURREAL_DB})


def build_app():
    """Return FastMCP's Starlette app with an extra `/health` route.

    We mutate the FastMCP-built app rather than wrapping it in a Mount because
    the Mount approach drops the FastMCP lifespan that initialises the
    streamable-HTTP session manager. Adding a route in-place preserves the
    lifespan and keeps `/mcp` working.
    """
    inner = mcp.streamable_http_app()
    inner.add_route("/health", _health_endpoint, methods=["GET", "HEAD"])
    return inner


app = build_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "0.0.0.0")
    logger.info(f"starting kg_mcp on http://{host}:{port}  (mcp at /mcp, health at /health)")
    uvicorn.run(app, host=host, port=port, log_level="info")
