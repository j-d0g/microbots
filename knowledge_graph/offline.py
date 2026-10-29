"""Deterministic demo outputs, not semantic extraction or a real LLM replay.

Exercises the same Pydantic validation, agents, writers and graph edges as live
ingestion. Every generated insight is labeled offline/demo.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

from pydantic_ai.models.test import TestModel


def model(output: dict[str, Any] | None = None) -> TestModel:
    return TestModel(call_tools=[], custom_output_args=output or {})


def triage(items) -> dict[str, Any]:
    records = []
    for item in items:
        body = str(item.content.get("body") or "")
        speakers = sorted(set(re.findall(r"^([\w .@-]{2,60}):", body, re.MULTILINE)))
        records.append({
            "external_id": item.external_id,
            "title": item.content.get("title") or item.external_id,
            "content": body,
            "summary": f"[offline/demo] {body[:400]}",
            "signal_level": "mid",
            "source_type": item.source_type,
            "occurred_at": item.occurred_at.isoformat() if item.occurred_at else "",
            "entities_mentioned": [{"name": name} for name in speakers],
        })
    return {
        "integration_metadata": {"user_purpose": "Offline/demo fixture ingestion"},
        "chat_records": records,
        "items_dropped": [],
    }


def memories(chats: list[dict], integration: str) -> dict:
    return {"memories": [{
        "content": f"[offline/demo] {chat['title']}: {chat.get('summary', '')}",
        "memory_type": "fact",
        "confidence": 0.5,
        "tags": ["offline_demo"],
        "source_chat_ids": [str(chat["id"])],
        "about_integrations": [integration],
    } for chat in chats]}


def entities(stubs: list[dict]) -> dict:
    return {"entities": [{
        "canonical_id": str(stub["id"]),
        "name": stub["name"],
        "entity_type": stub.get("entity_type", "person"),
        "description": stub.get("description") or "[offline/demo] Fixture speaker; not semantically resolved.",
        "aliases": stub.get("aliases") or [],
        "tags": sorted(set((stub.get("tags") or []) + ["offline_demo"])),
    } for stub in stubs]}


def skills(chats: list[dict], integration: str) -> dict:
    groups = defaultdict(list)
    for chat in chats:
        groups[chat["source_type"]].append(chat)
    return {"skills": [{
        "name": f"[offline/demo] Review {source_type} records",
        "slug": f"offline_demo_{integration}_{source_type}",
        "description": "Demo grouping by source type, not an inferred behavioral pattern.",
        "steps": [f"{integration}:read_record", "review_record"],
        "strength": len(group),
        "tags": ["offline_demo"],
        "integrations_used": [integration],
        "evidence_chat_ids": [str(chat["id"]) for chat in group],
    } for source_type, group in sorted(groups.items()) if len(group) >= 2]}


def workflows(skills: list[dict]) -> dict:
    demo_skills = sorted(
        (skill for skill in skills if "offline_demo" in (skill.get("tags") or [])),
        key=lambda skill: skill["slug"],
    )
    if len(demo_skills) < 2:
        return {"workflows": []}
    return {"workflows": [{
        "name": "[offline/demo] Review fixture sources",
        "slug": "offline_demo_review_sources",
        "description": "Demo sequence of source groups, not an inferred workflow.",
        "trigger": "Offline fixture ingestion",
        "outcome": "Review fixture records from each source",
        "tags": ["offline_demo"],
        "skill_sequence": [{"skill_slug": skill["slug"], "step_order": i}
                           for i, skill in enumerate(demo_skills, 1)],
        "integrations_used": sorted({slug for skill in demo_skills
                                     for slug in skill.get("integrations_used", [])}),
    }]}


def wiki(node, rows: list[dict]) -> dict:
    parent = f"> Parent: [{node.parent_path}]({node.parent_path})\n\n" if node.parent_path else ""
    # Bound each row so a large graph slice cannot exceed the page's token budget.
    excerpts = "\n".join(f"- {json.dumps(row, default=str, ensure_ascii=False)[:200]}" for row in rows[:5])
    return {
        "path": node.path,
        "content": f"# {node.path}\n\n{parent}[offline/demo] Deterministic graph summary; no LLM was called.\n\n{excerpts or 'No records in this graph slice.'}\n",
        "rationale": "Offline/demo rendering of the current graph slice.",
    }
