"""Per-integration skill detection prompt (Pass 1)."""
from __future__ import annotations

import json
from typing import Any


def build_system(integration_name: str) -> str:
    return f"""You are analyzing {integration_name} chat data to detect REPEATED behavioral
patterns (skills) the user performs.

A skill is an atomic, repeatable pipeline of actions. To qualify:
- It must have been observed AT LEAST 2 times in the data
- It should have identifiable steps
- It represents something the user DOES, not just talks about

For each skill you find:
- name: human-readable name
- slug: snake_case identifier (e.g., "triage_bug_from_slack")
- description: what the skill accomplishes
- steps: ordered list, format "{{tool}}:{{action}}" where possible
  (e.g., "slack:read_message", "linear:create_ticket", "github:open_pr")
  Fall back to natural language if tool:action doesn't fit.
- strength: number of times this pattern was observed (must be >= 2 to qualify)
- frequency: estimated frequency ("daily", "weekly", "per-deploy", "ad-hoc")
- evidence_chat_ids: the chat record IDs where you observed this pattern
- integrations_used: list of integration slugs this skill touches

Also list any patterns observed only ONCE in "candidates_below_threshold" —
they may combine with evidence from other integrations in the next pass.

Focus on BEHAVIORAL patterns, not content patterns.
"User discusses AI" is NOT a skill.
"User creates a Linear ticket every time a bug is reported in Slack" IS a skill.

Return ONLY valid JSON:
{{
  "skills": [
    {{
      "name": "string",
      "slug": "string",
      "description": "string",
      "steps": ["tool:action"],
      "strength": 2,
      "frequency": "daily|weekly|per-deploy|ad-hoc",
      "tags": ["string"],
      "integrations_used": ["slack"],
      "evidence_chat_ids": ["chat:ingest_..."],
      "evidence_memory_ids": []
    }}
  ],
  "candidates_below_threshold": [
    {{
      "name": "string",
      "observation_count": 1,
      "reason_excluded": "Only observed once",
      "evidence_chat_ids": ["chat:ingest_..."]
    }}
  ]
}}"""


def build_user_prompt(
    new_chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> str:
    parts: list[str] = []

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
        parts.append("\n=== OLD CHAT SUMMARIES (historical context) ===")
        for c in old_summaries[:100]:
            parts.append(json.dumps({
                "id": str(c.get("id", "")),
                "source_type": c.get("source_type", ""),
                "summary": c.get("summary", ""),
            }, ensure_ascii=False))

    if memories:
        parts.append("\n=== RELEVANT MEMORIES (for context) ===")
        for m in memories[:50]:
            parts.append(json.dumps({
                "id": str(m.get("id", "")),
                "content": m.get("content", ""),
                "memory_type": m.get("memory_type", ""),
            }, ensure_ascii=False))

    return "\n".join(parts)
