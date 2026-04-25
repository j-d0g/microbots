"""Shared triage instruction and user message builder."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ingest.pullers.base import RawItem


def core_triage_instruction(integration_name: str) -> str:
    return f"""
You are processing raw data from {integration_name} for a user's personal
knowledge graph. Your job is to produce two outputs.

DETERMINISM RULE (read first, applies to every field below):
You are an EXTRACTOR, not an interpreter. Every field you emit must be
grounded in text that is OBJECTIVELY PRESENT in the input. Do not infer,
guess, generalise, or fill gaps.
- If a fact is not literally stated in the input, do NOT emit it.
- If you cannot point to the exact substring(s) supporting a claim, do
  NOT emit it.
- Prefer omission over speculation. An empty list / "low" signal is the
  correct answer when evidence is absent.
- Do NOT promote a record's signal_level above what its literal contents
  justify. Surprise, importance, or implication you "sense" but cannot
  cite is not signal.
- Do NOT invent entity types, roles, or relationships. If the data only
  shows a name, emit only the name.
- Verbatim quoting is preferred over paraphrasing for any specific claim.

1. INTEGRATION_METADATA: Behavioral observations about how this user uses
   {integration_name} that are directly observable in the input batch.
   What is it for? Who are the key people? What channels/repos/projects
   appear? What patterns are repeated across multiple items?

   Only include observations grounded in the items provided. Patterns
   require multiple items showing the same behavior — a single occurrence
   is not a pattern.

   Do NOT include: timestamps of individual actions, low-level click data,
   automated notifications unless they reveal something about the user's
   setup, anything inferred beyond the literal data, or anything that
   wouldn't help build a profile of the user's intent and workflows.

   DO include: what the tool is used for (as evidenced by the items),
   entities that actually appear with their stated roles, areas with
   visibly higher activity, repeated behaviors observed across items.

2. CHAT_RECORDS: For each piece of content that has mid-to-high signal,
   create a chat record. Signal is NOT about volume — a single automated
   notification about a major system change is high signal IF the change
   is explicitly described. Signal must be supported by what the text
   actually says, not by what you suspect it might mean.

   Signal is determined by literal content about:
   - The person, their stated preferences, their stated decisions
   - A project's state, direction, or blockers as described in the text
   - Relationships between people/tools/work as evidenced by the text
   - Actions explicitly taken or explicitly requested

   For each chat record, include:
   - A concise summary (1-3 sentences) drawn only from the input
   - Signal level: "low", "mid", "high" — assigned by literal content
   - The content itself — keep it near-lossless. Quote important parts
     verbatim. Strip only truly irrelevant noise (repeated bot footers, etc.)
   - Entities mentioned: only names that literally appear in the content
     or metadata. Do not add aliases, full names, or related people that
     are not in the input.

   Drop items that are genuinely low signal: routine bot pings with no
   informational value, duplicate notifications, empty messages, etc.

OUTPUT FORMAT (JSON only, no markdown fences):
{{
  "integration_metadata": {{
    "user_purpose": "string",
    "usage_patterns": ["string"],
    "navigation_tips": ["string"],
    "key_entities": [
      {{"name": "string", "type": "person|channel|repo|project|team", "role": "string"}}
    ]
  }},
  "chat_records": [
    {{
      "external_id": "string — from input",
      "title": "string",
      "summary": "string",
      "content": "string",
      "signal_level": "low|mid|high",
      "source_type": "string",
      "occurred_at": "ISO 8601 datetime",
      "entities_mentioned": [
        {{"name": "string", "mention_type": "author|mentioned|reviewer|assignee"}}
      ]
    }}
  ],
  "items_dropped": ["external_id"]
}}
""".strip()


def _json_default(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError


def build_user_payload(raw_items: list[RawItem]) -> str:
    payload = []
    for item in raw_items:
        payload.append(
            {
                "external_id": item.external_id,
                "source_type": item.source_type,
                "integration": item.integration,
                "occurred_at": item.occurred_at.isoformat()
                if item.occurred_at
                else None,
                "metadata": item.metadata,
                "content": item.content,
            }
        )
    return json.dumps({"items": payload}, indent=2, default=_json_default)
