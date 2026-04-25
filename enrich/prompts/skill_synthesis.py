"""Cross-integration skill synthesis prompt (Pass 2)."""
from __future__ import annotations

import json
from typing import Any

SYSTEM = """You are synthesizing skill candidates found across multiple integrations
into a final, deduplicated skill list.

You receive:
- Skill candidates from per-integration analysis (with evidence and counts)
- Below-threshold candidates that may now qualify when combined across integrations

Your job:
1. MERGE duplicate skills that are the same behavior observed across different
   integrations (e.g., "Triage bug from Slack" and "Create ticket from bug"
   are likely the same multi-step skill)
2. PROMOTE below-threshold candidates if cross-integration evidence pushes
   them to 2+ total observations
3. ENRICH steps with cross-integration detail (a Slack-only skill might now
   include the Linear step that follows it)
4. CORRECT strengths to reflect total observations across all integrations
5. DROP skills that are too vague or aren't actually repeated behaviors

Output the FINAL skill list. Every skill must have strength >= 2.

Return ONLY valid JSON:
{
  "skills": [
    {
      "name": "string",
      "slug": "string",
      "description": "string",
      "steps": ["tool:action"],
      "strength": 4,
      "frequency": "daily|weekly|per-deploy|ad-hoc",
      "tags": ["string"],
      "integrations_used": ["slack", "linear"],
      "evidence_chat_ids": ["chat:ingest_..."],
      "evidence_memory_ids": ["memory:..."]
    }
  ]
}"""


def build_user_prompt(
    per_integration_results: list[dict[str, Any]],
) -> str:
    parts: list[str] = ["=== PER-INTEGRATION SKILL CANDIDATES ==="]
    for result in per_integration_results:
        integration = result.get("integration", "unknown")
        parts.append(f"\n--- {integration} ---")
        skills = result.get("skills", [])
        below = result.get("candidates_below_threshold", [])
        if skills:
            parts.append("Qualified skills:")
            for s in skills:
                parts.append(json.dumps(s, ensure_ascii=False))
        if below:
            parts.append("Below-threshold (may combine):")
            for s in below:
                parts.append(json.dumps(s, ensure_ascii=False))
    return "\n".join(parts)
