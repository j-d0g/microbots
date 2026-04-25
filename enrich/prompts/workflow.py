"""Workflow composition prompt."""
from __future__ import annotations

import json
from typing import Any

SYSTEM = """You are composing workflows from discovered skills in a user's knowledge graph.

A workflow is a MULTI-STEP process that chains multiple skills together.
It represents a higher-order pattern: "when X happens, the user does
skill A → skill B → skill C."

You are given:
- SKILLS: the user's detected behavioral patterns with their strengths,
  steps, and integrations
- CHAT EVIDENCE: conversations showing these skills being used in sequence
- INTEGRATION METADATA: how the user uses each tool

Your job:
1. Find sequences where 2+ skills are consistently chained together
2. Identify the TRIGGER (what kicks off this workflow — be specific)
3. Identify the OUTCOME (the end result — be specific)
4. Order the skills in the sequence (step_order starting at 1)
5. Mark which skills are optional vs required in the workflow
6. Identify which entities are involved (people, channels, repos, teams)

Rules:
- Prefer workflows backed by strong skills (strength >= 2)
- A workflow with only 1 skill is just a skill, not a workflow — minimum 2 skills
- The trigger and outcome should reference specific integrations and entities
  where possible: "bug reported in #bugs channel" not "bug is found"
- skill_slug must match exactly one of the skills provided

Return ONLY valid JSON:
{
  "workflows": [
    {
      "name": "string",
      "slug": "string",
      "description": "string",
      "trigger": "string — specific trigger condition",
      "outcome": "string — specific end result",
      "frequency": "daily|weekly|per-deploy|ad-hoc",
      "tags": ["string"],
      "skill_sequence": [
        {"skill_slug": "string", "step_order": 1, "optional": false}
      ],
      "integrations_used": ["slack", "linear"],
      "entities_involved": [
        {"name": "string", "type": "person|channel|repo|project|team", "role": "string"}
      ],
      "evidence_chat_ids": ["chat:ingest_..."]
    }
  ]
}"""


def build_user_prompt(
    skills: list[dict[str, Any]],
    new_chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    integration_metadata: list[dict[str, Any]],
) -> str:
    parts: list[str] = []

    parts.append("=== SKILLS (use exact slugs in skill_sequence) ===")
    for s in skills:
        parts.append(json.dumps({
            "name": s.get("name", ""),
            "slug": s.get("slug", ""),
            "description": s.get("description", ""),
            "steps": s.get("steps") or [],
            "strength": s.get("strength", 1),
            "integrations_used": s.get("integrations_used") or [],
            "tags": s.get("tags") or [],
        }, ensure_ascii=False))

    parts.append("\n=== CHAT EVIDENCE ===")
    for c in new_chats:
        parts.append(json.dumps({
            "id": str(c.get("id", "")),
            "title": c.get("title", ""),
            "source_type": c.get("source_type", ""),
            "content": c.get("content", ""),
        }, ensure_ascii=False))

    if old_summaries:
        parts.append("\n=== OLD CHAT SUMMARIES ===")
        for c in old_summaries[:100]:
            parts.append(json.dumps({
                "id": str(c.get("id", "")),
                "source_type": c.get("source_type", ""),
                "summary": c.get("summary", ""),
            }, ensure_ascii=False))

    if integration_metadata:
        parts.append("\n=== INTEGRATION METADATA ===")
        for intg in integration_metadata:
            parts.append(json.dumps({
                "slug": intg.get("slug", ""),
                "user_purpose": intg.get("user_purpose", ""),
                "usage_patterns": intg.get("usage_patterns") or [],
            }, ensure_ascii=False))

    return "\n".join(parts)
