"""SurrealQL named queries used by both the MCP tools and the REST mirror.

Ported verbatim from ``knowledge_graph/db/queries.py`` with one important
change: multi-statement ``LET ... RETURN`` scripts were rewritten as single
SELECTs with subqueries because SurrealDB v3 does not return values from
multi-statement scripts over the WebSocket RPC.
"""

from __future__ import annotations

Q_INTEGRATIONS_OVERVIEW = """
SELECT
    slug, name, category, frequency, description, user_purpose,
    (SELECT out.slug FROM co_used_with WHERE in = $parent.id) AS co_used_with_slugs
FROM integration ORDER BY slug ASC
"""

Q_INTEGRATION_DETAIL = """
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

Q_ENTITIES_BY_TYPE = """
SELECT
    entity_type, name, id, description, aliases, tags,
    count(SELECT 1 FROM chat_mentions WHERE out = $parent.id) AS chat_mention_count
FROM entity
WHERE entity_type = $entity_type
ORDER BY name ASC
"""

Q_ENTITY_DETAIL = """
SELECT
    *,
    (SELECT out.slug AS integration_slug, handle, role
        FROM appears_in WHERE in = $id) AS appears_in_edges,
    (SELECT in.id AS chat_id, in.title, in.source_type, mention_type
        FROM chat_mentions WHERE out = $id LIMIT 20) AS mentions
FROM entity WHERE id = $id LIMIT 1
"""

Q_MEMORIES_TOP = """
SELECT * FROM memory ORDER BY {order_field} DESC LIMIT $limit
"""

Q_SKILLS_ALL = """
SELECT
    id, name, slug, description, steps, frequency, strength, tags,
    array::distinct(
        (SELECT out.slug FROM skill_uses WHERE in = $parent.id).out.slug
    ) AS integrations
FROM skill
WHERE strength >= $min_strength
ORDER BY strength DESC, name ASC
"""

Q_WORKFLOWS_ALL = """
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

Q_CHATS_SUMMARY = """
SELECT out.slug AS integration, signal_level, count() AS count
FROM chat_from
GROUP BY out.slug, signal_level
ORDER BY count DESC
"""

Q_USER_PROFILE = """
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

Q_ENTITY_TYPES = """
SELECT entity_type, count() AS count
FROM entity
GROUP BY entity_type
ORDER BY count DESC
"""

Q_WIKI_PAGE = """
SELECT path, content, depth, layer FROM wiki_page WHERE path = $path LIMIT 1
"""

Q_WIKI_TREE = """
SELECT path, depth, layer FROM wiki_page ORDER BY path ASC
"""
