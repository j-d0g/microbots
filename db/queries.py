"""Whitelisted SurrealQL named queries + Pydantic result models.

The LLM (via the wiki agent's query_graph tool) may only call queries by name.
No raw SurrealQL escapes through this layer.
"""
from __future__ import annotations

from typing import Any, Callable

from db.models import (
    Chat,
    ChatsSummaryRow,
    Entity,
    Integration,
    IntegrationDetailResult,
    IntegrationsOverviewRow,
    Memory,
    Skill,
    UserProfile,
    UserProfileResult,
    Workflow,
    WorkflowWithSkills,
)

# ---------------------------------------------------------------------------
# Raw SurrealQL strings — only these run against the DB
# ---------------------------------------------------------------------------

_Q_INTEGRATIONS_OVERVIEW = """
SELECT
    slug,
    name,
    category,
    frequency,
    description,
    user_purpose,
    (SELECT out.slug FROM co_used_with WHERE in = $parent.id) AS co_used_with_slugs
FROM integration
ORDER BY slug ASC
"""

_Q_INTEGRATION_DETAIL = """
LET $intg = (SELECT * FROM integration WHERE slug = $slug LIMIT 1)[0];
LET $entities = SELECT * FROM entity WHERE <-appears_in<-(integration WHERE slug = $slug);
LET $top_memories = SELECT * FROM memory WHERE ->memory_about->(integration WHERE slug = $slug)
    ORDER BY confidence DESC LIMIT $limit;
LET $skills = SELECT * FROM skill WHERE ->skill_uses->(integration WHERE slug = $slug);
RETURN {integration: $intg, entities: $entities, top_memories: $top_memories, skills: $skills};
"""

_Q_ENTITIES_BY_TYPE = """
SELECT
    entity_type,
    name,
    id,
    description,
    aliases,
    tags,
    count(SELECT 1 FROM chat_mentions WHERE out = $parent.id) AS chat_mention_count
FROM entity
WHERE entity_type = $entity_type
ORDER BY name ASC
"""

_Q_ENTITY_DETAIL = """
LET $e = (SELECT * FROM entity WHERE id = $id LIMIT 1)[0];
LET $appears_in = SELECT out.slug AS integration_slug, handle, role FROM appears_in WHERE in = $id;
LET $mentions = SELECT in.id AS chat_id, in.title, in.source_type, mention_type
    FROM chat_mentions WHERE out = $id LIMIT 20;
RETURN {entity: $e, appears_in: $appears_in, mentions: $mentions};
"""

_Q_MEMORIES_TOP = """
SELECT * FROM memory
ORDER BY {order_field} DESC
LIMIT $limit
"""

_Q_SKILLS_ALL = """
SELECT
    id, name, slug, description, steps, frequency, strength, tags,
    array::distinct((SELECT out.slug FROM skill_uses WHERE in = $parent.id).out.slug) AS integrations
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
FROM workflow
ORDER BY name ASC
"""

_Q_CHATS_SUMMARY = """
SELECT
    out.slug AS integration,
    signal_level,
    count() AS count
FROM chat_from
GROUP BY out.slug, signal_level
ORDER BY count DESC
"""

_Q_USER_PROFILE = """
LET $profile = (SELECT * FROM user_profile LIMIT 1)[0];
LET $chat_count = (SELECT count() AS n FROM chat GROUP ALL)[0].n ?? 0;
LET $memory_count = (SELECT count() AS n FROM memory GROUP ALL)[0].n ?? 0;
LET $skill_count = (SELECT count() AS n FROM skill GROUP ALL)[0].n ?? 0;
LET $workflow_count = (SELECT count() AS n FROM workflow GROUP ALL)[0].n ?? 0;
LET $entity_count = (SELECT count() AS n FROM entity GROUP ALL)[0].n ?? 0;
LET $integration_count = (SELECT count() AS n FROM integration GROUP ALL)[0].n ?? 0;
RETURN {
    profile: $profile,
    chat_count: $chat_count,
    memory_count: $memory_count,
    skill_count: $skill_count,
    workflow_count: $workflow_count,
    entity_count: $entity_count,
    integration_count: $integration_count
};
"""

_Q_ENTITY_TYPES = """
SELECT entity_type, count() AS count
FROM entity
GROUP BY entity_type
ORDER BY count DESC
"""


# ---------------------------------------------------------------------------
# Registry: name → {query_str, params_schema, result_model}
# ---------------------------------------------------------------------------

def _noop_validate(params: dict[str, Any]) -> dict[str, Any]:
    return params


def _require(params: dict[str, Any], *keys: str) -> dict[str, Any]:
    for k in keys:
        if k not in params:
            raise ValueError(f"Named query requires param '{k}'")
    return params


class QueryDef:
    """Metadata for a single named query."""
    def __init__(
        self,
        surql: str,
        *,
        validate: Callable[[dict[str, Any]], dict[str, Any]] = _noop_validate,
        result_model: type | None = None,
        description: str = "",
    ) -> None:
        self.surql = surql
        self.validate = validate
        self.result_model = result_model
        self.description = description

    def validated_params(self, params: dict[str, Any]) -> dict[str, Any]:
        return self.validate(params)


NAMED_QUERIES: dict[str, QueryDef] = {
    "integrations_overview": QueryDef(
        surql=_Q_INTEGRATIONS_OVERVIEW,
        result_model=IntegrationsOverviewRow,
        description="All integration nodes with frequency and co_used_with slugs.",
    ),
    "integration_detail": QueryDef(
        surql=_Q_INTEGRATION_DETAIL,
        validate=lambda p: _require(p, "slug"),
        result_model=IntegrationDetailResult,
        description="One integration + its entities, top memories, skills. Params: {slug, limit=10}.",
    ),
    "entities_by_type": QueryDef(
        surql=_Q_ENTITIES_BY_TYPE,
        validate=lambda p: _require(p, "entity_type"),
        result_model=Entity,
        description="Entities of a given type with chat_mention counts. Params: {entity_type}.",
    ),
    "entity_detail": QueryDef(
        surql=_Q_ENTITY_DETAIL,
        validate=lambda p: _require(p, "id"),
        description="One entity + all edges. Params: {id}.",
    ),
    "memories_top": QueryDef(
        surql=_Q_MEMORIES_TOP,
        result_model=Memory,
        description="Top memories sorted by confidence or recency. Params: {limit=20, by='confidence'|'recency'}.",
    ),
    "skills_all": QueryDef(
        surql=_Q_SKILLS_ALL,
        result_model=Skill,
        description="All skills above min_strength threshold. Params: {min_strength=1}.",
    ),
    "workflows_all": QueryDef(
        surql=_Q_WORKFLOWS_ALL,
        result_model=WorkflowWithSkills,
        description="All workflows with ordered skill chain. No params required.",
    ),
    "chats_summary": QueryDef(
        surql=_Q_CHATS_SUMMARY,
        result_model=ChatsSummaryRow,
        description="Chat counts grouped by integration and signal_level.",
    ),
    "user_profile": QueryDef(
        surql=_Q_USER_PROFILE,
        result_model=UserProfileResult,
        description="Root user profile node + aggregate counts.",
    ),
    "entity_types": QueryDef(
        surql=_Q_ENTITY_TYPES,
        description="All distinct entity_type values with counts.",
    ),
}
