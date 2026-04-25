"""Context loading for the enrichment layer."""
from __future__ import annotations

import logging
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


async def load_enrichment_context(
    db: AsyncSurreal,
    new_chat_ids: list[RecordID],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Returns (new_chats_full, old_chat_summaries, existing_memories).

    new_chats: full content for chats from this ingest cycle.
    old_summaries: summary-only for pre-existing chats (observation masking).
    existing_memories: content + type for dedup awareness.
    """
    if new_chat_ids:
        res_new = await db.query(
            "SELECT * FROM chat WHERE id IN $ids",
            {"ids": new_chat_ids},
        )
        new_chats = unwrap_surreal_rows(res_new)

        res_old = await db.query(
            "SELECT id, summary, source_type, signal_level, occurred_at "
            "FROM chat WHERE id NOT IN $ids",
            {"ids": new_chat_ids},
        )
        old_summaries = unwrap_surreal_rows(res_old)
    else:
        # No new_chat_ids supplied — treat all chats as new (for smoke testing)
        res_all = await db.query("SELECT * FROM chat")
        new_chats = unwrap_surreal_rows(res_all)
        old_summaries = []

    res_mem = await db.query(
        "SELECT id, content, memory_type, confidence FROM memory"
    )
    existing_memories = unwrap_surreal_rows(res_mem)

    log.info(
        "Context loaded: %d new chats, %d old summaries, %d existing memories",
        len(new_chats),
        len(old_summaries),
        len(existing_memories),
    )
    return new_chats, old_summaries, existing_memories


def group_chats_by_integration(
    new_chats: list[dict[str, Any]],
    db_chat_from: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Map integration slug → list of chats."""
    chat_to_intg: dict[str, str] = {}
    for row in db_chat_from:
        c_id = str(row.get("in", ""))
        i_id = str(row.get("out", ""))
        slug = i_id.split(":")[-1] if ":" in i_id else i_id
        chat_to_intg[c_id] = slug

    groups: dict[str, list[dict[str, Any]]] = {}
    for chat in new_chats:
        c_id = str(chat.get("id", ""))
        slug = chat_to_intg.get(c_id, "unknown")
        groups.setdefault(slug, []).append(chat)
    return groups
