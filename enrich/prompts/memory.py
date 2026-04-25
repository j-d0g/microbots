"""Memory extraction prompts."""
from __future__ import annotations

import json
from typing import Any

SYSTEM = """You are extracting durable memories from chat data in a user's knowledge graph.

A memory is a high-signal insight that helps an AI agent understand:
- WHO this person is and how they work
- WHAT they care about, prefer, or decide
- HOW they use their tools and interact with people
- FACTS about projects, people, relationships that persist

Extract as many distinct memories as the data supports. Each memory should be:
- Self-contained (readable without the source chat)
- Specific (not vague generalizations)
- Attributable (source_chat_ids must reference the actual chat IDs provided)

Memory types:
- "preference": user likes/dislikes, style choices, tool preferences
- "decision": a choice that was made and may inform future choices
- "action_pattern": something the user does repeatedly or characteristically
- "fact": a durable truth about a person, project, team, or tool

Confidence: 0.0-1.0. High (0.85+) if directly stated, lower (0.5-0.84) if inferred.

You are seeing:
- NEW chats (full content) — primary source, extract memories from these
- OLD chat summaries — historical context only, do not create memories solely from these
- EXISTING memories — for awareness; avoid exact duplicates but overlapping
  memories sourced from different chats are fine

Do NOT create memories about:
- Transient state (CI passed, build running, "message sent")
- Content only relevant for hours
- Exact duplicates of existing memories (same insight, same source chat IDs)

Return ONLY valid JSON matching this schema:
{
  "memories": [
    {
      "content": "string — the distilled insight, self-contained",
      "memory_type": "preference|decision|action_pattern|fact",
      "confidence": 0.0-1.0,
      "tags": ["tag1", "tag2"],
      "source_chat_ids": ["chat:ingest_...", "chat:ingest_..."],
      "about_entities": [{"name": "string", "type": "person|channel|repo|project|team"}],
      "about_integrations": ["slack", "github"]
    }
  ]
}"""


def build_user_prompt(
    integration: str,
    new_chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    existing_memories: list[dict[str, Any]],
) -> str:
    parts: list[str] = [f"Integration context: {integration}\n"]

    parts.append("=== NEW CHATS (full content) ===")
    for c in new_chats:
        parts.append(json.dumps({
            "id": str(c.get("id", "")),
            "title": c.get("title", ""),
            "source_type": c.get("source_type", ""),
            "content": c.get("content", ""),
            "summary": c.get("summary", ""),
        }, ensure_ascii=False))

    if old_summaries:
        parts.append("\n=== OLD CHAT SUMMARIES (context only) ===")
        for c in old_summaries[:200]:
            parts.append(json.dumps({
                "id": str(c.get("id", "")),
                "source_type": c.get("source_type", ""),
                "summary": c.get("summary", ""),
            }, ensure_ascii=False))

    if existing_memories:
        parts.append("\n=== EXISTING MEMORIES (avoid exact duplicates) ===")
        for m in existing_memories[:100]:
            parts.append(json.dumps({
                "id": str(m.get("id", "")),
                "content": m.get("content", ""),
                "memory_type": m.get("memory_type", ""),
            }, ensure_ascii=False))

    return "\n".join(parts)
