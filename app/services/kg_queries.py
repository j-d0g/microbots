"""SurrealQL queries used by the knowledge graph REST API."""

from __future__ import annotations

Q_INTEGRATIONS_OVERVIEW = """
SELECT
    slug, name, category, frequency, description, user_purpose,
    (SELECT out.slug, frequency FROM co_used_with WHERE in = $parent.id) AS co_used_with_slugs
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
SELECT entity_type, name, id, description, aliases, tags
FROM entity
WHERE entity_type = $entity_type
ORDER BY name ASC
"""

Q_ENTITIES_ALL = """
SELECT entity_type, name, id, description, aliases, tags
FROM entity
ORDER BY name ASC
"""

Q_ENTITY_CHAT_MENTIONS = """
SELECT out AS entity_id, count() AS chat_mention_count
FROM chat_mentions
WHERE out IN $ids
GROUP BY entity_id
"""

Q_ENTITY_INTEGRATIONS = """
SELECT in AS entity_id, out.slug AS integration_slug
FROM appears_in
WHERE in IN $ids
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

Q_MEMORY_INTEGRATIONS = """
SELECT in AS memory_id, out.slug AS integration_slug
FROM memory_about
WHERE in IN $ids AND record::tb(out) = 'integration'
"""

Q_SEARCH_MEMORIES = """
SELECT id, content, confidence
FROM memory
WHERE string::contains(string::lowercase(content), string::lowercase($query))
ORDER BY confidence DESC
LIMIT $limit
"""

Q_SEARCH_ENTITIES = """
SELECT id, name, entity_type, description, tags
FROM entity
WHERE string::contains(string::lowercase(name), string::lowercase($query))
    OR string::contains(string::lowercase(description ?? ''), string::lowercase($query))
ORDER BY name ASC
LIMIT $limit
"""

Q_SEARCH_WORKFLOWS = """
SELECT id, slug, name, description
FROM workflow
WHERE string::contains(string::lowercase(name), string::lowercase($query))
    OR string::contains(string::lowercase(description ?? ''), string::lowercase($query))
    OR string::contains(string::lowercase(slug), string::lowercase($query))
ORDER BY name ASC
LIMIT $limit
"""

Q_SEARCH_INTEGRATIONS = """
SELECT slug, name,
    (SELECT out.slug AS slug, out.name AS name FROM co_used_with WHERE in = $parent.id) AS connections,
    (SELECT in.slug AS slug, in.name AS name FROM co_used_with WHERE out = $parent.id) AS incoming_connections
FROM integration
WHERE string::contains(string::lowercase(name), string::lowercase($query))
    OR string::contains(string::lowercase(slug), string::lowercase($query))
ORDER BY name ASC
LIMIT $limit
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

Q_CHATS_BY_SOURCE = """
SELECT * FROM chat
WHERE source_type = $source_type
ORDER BY occurred_at DESC
LIMIT $limit
"""

Q_TODAY_CANDIDATES = """
SELECT id, title, story, suggested_action, signal_axes, status,
       time_sensitive_until, created_at, updated_at
FROM automation_candidate
WHERE status IN ['open', 'suggested', 'accepted', 'dismissed']
"""

Q_TODAY_CHAT_EVIDENCE = """
SELECT in AS candidate_id, out.id AS id, out.title AS title, out.summary AS summary
FROM candidate_evidence_chat
WHERE in IN $ids
"""

Q_TODAY_ENTITY_EVIDENCE = """
SELECT in AS candidate_id, out.id AS id, out.name AS name, out.description AS description
FROM candidate_evidence_entity
WHERE in IN $ids
"""

Q_TODAY_MEMORY_EVIDENCE = """
SELECT in AS candidate_id, out.id AS id, out.content AS content
FROM candidate_evidence_memory
WHERE in IN $ids
"""

Q_TODAY_RECENT = """
SELECT id, title, source_type, occurred_at ?? created_at AS occurred_at
FROM chat
ORDER BY occurred_at DESC
LIMIT 5
"""

Q_WIKI_PAGE = "SELECT path, content, depth, layer FROM wiki_page WHERE path = $path LIMIT 1"

Q_WIKI_TREE = "SELECT path, depth, layer FROM wiki_page ORDER BY path ASC"
