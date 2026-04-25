"""Shared triage instruction and user message builder."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ingest.pullers.base import RawItem


def core_triage_instruction(integration_name: str) -> str:
    return f"""
You are processing raw data from {integration_name} for a user's personal
knowledge graph. Your job is to produce two outputs:

1. INTEGRATION_METADATA: Behavioral observations about how this user uses
   {integration_name}. What is it for? Who are the key people? What channels/
   repos/projects matter most? What patterns do you see? Only include
   observations that would help an AI agent understand how to navigate and
   use this tool on the user's behalf.

   Do NOT include: timestamps of individual actions, low-level click data,
   automated notifications unless they reveal something about the user's
   setup, or anything that wouldn't help build a profile of the user's
   intent and workflows.

   DO include: what the tool is used for, who the important entities are
   and their roles, which areas are most active, any observable patterns
   in how the user works.

2. CHAT_RECORDS: For each piece of content that has mid-to-high signal,
   create a chat record. Signal is NOT about volume — a single automated
   notification about a major system change is high signal. Signal is about
   how much this content tells you about:
   - The person, their preferences, their decisions
   - A project's state, direction, or blockers
   - Important relationships between people, tools, or work
   - Actions taken or requested

   For each chat record, include:
   - A concise summary (1-3 sentences)
   - Signal level: "low", "mid", "high"
   - The content itself — keep it near-lossless. Quote important parts
     verbatim. Strip only truly irrelevant noise (repeated bot footers, etc.)
   - Entities mentioned (people, channels, repos, projects — names only)

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
