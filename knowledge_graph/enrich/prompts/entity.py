"""Entity resolution prompts."""
from __future__ import annotations

import json
from typing import Any

SYSTEM = """You are resolving and enriching entities in a user's knowledge graph.

You are given entity stubs (often just a name and default "person" type) extracted
during data ingestion. Your job is to:

1. MERGE duplicates: the same real-world entity may appear with different names
   across integrations (e.g., "@alice" on Slack = "alice-dev" on GitHub =
   "Alice Chen" on Linear). Return merge_ids listing stub IDs to collapse into
   canonical_id. Only merge when you are confident they are the same entity.

2. ENRICH each entity with:
   - Correct entity_type: "person", "channel", "repo", "project", "team"
   - Description: what/who this entity is, their role, why they matter to the user
   - Aliases: all known name variants across platforms
   - Tags: categorization for search

3. MAP integrations: for each entity, which integrations they appear in,
   with what handle/identifier and role.

4. INFER relationships from chat evidence. Use relationship_type values:
   "member_of", "leads", "owns", "maintains", "reports_to",
   "collaborates_with", "part_of", "tracks"

Handle ALL entity types — people, channels, repositories, projects, teams.
Not everything is a person.

Return ONLY valid JSON matching this schema:
{
  "entities": [
    {
      "canonical_id": "entity:existing_id or the name to use as canonical",
      "name": "Canonical display name",
      "entity_type": "person|channel|repo|project|team",
      "description": "string — role and context",
      "aliases": ["string"],
      "tags": ["string"],
      "merge_ids": ["entity:id_to_collapse_into_canonical"],
      "integrations": [
        {"slug": "slack", "handle": "@alice", "role": "co-founder"}
      ],
      "relationships": [
        {
          "target_name": "Engineering",
          "target_type": "team",
          "relationship_type": "member_of",
          "context": "string"
        }
      ]
    }
  ]
}"""


def build_user_prompt(
    entity_stubs: list[dict[str, Any]],
    appears_in_rows: list[dict[str, Any]],
    chat_context: list[dict[str, Any]],
) -> str:
    parts: list[str] = []

    parts.append("=== ENTITY STUBS ===")
    for e in entity_stubs:
        parts.append(json.dumps({
            "id": str(e.get("id", "")),
            "name": e.get("name", ""),
            "entity_type": e.get("entity_type", "person"),
            "description": e.get("description", ""),
            "aliases": e.get("aliases") or [],
            "tags": e.get("tags") or [],
        }, ensure_ascii=False))

    if appears_in_rows:
        parts.append("\n=== APPEARS_IN EDGES (entity → integration with handle) ===")
        for row in appears_in_rows:
            parts.append(json.dumps({
                "entity_id": str(row.get("in", "")),
                "integration": str(row.get("out", "")),
                "handle": row.get("handle", ""),
                "role": row.get("role", ""),
            }, ensure_ascii=False))

    if chat_context:
        parts.append("\n=== CHAT CONTEXT (chats mentioning these entities) ===")
        for c in chat_context[:100]:
            parts.append(json.dumps({
                "id": str(c.get("id", "")),
                "title": c.get("title", ""),
                "source_type": c.get("source_type", ""),
                "summary": c.get("summary", ""),
            }, ensure_ascii=False))

    return "\n".join(parts)
