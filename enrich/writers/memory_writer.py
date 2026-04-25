"""Write memory records, chat_yields edges, and memory_about edges."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from ingest.db import relate_unique

log = logging.getLogger(__name__)


def _memory_id(content: str) -> str:
    h = hashlib.sha256(content.encode()).hexdigest()[:40]
    return f"enrich_{h}"


def _rec(table: str, id_part: str) -> RecordID:
    return RecordID(table, id_part)


def _parse_chat_id(chat_id_str: str) -> RecordID | None:
    """Parse 'chat:ingest_abc' or a RecordID-like string into a RecordID."""
    s = str(chat_id_str).strip()
    if ":" in s:
        table, _, id_part = s.partition(":")
        return RecordID(table.strip(), id_part.strip())
    return None


def _parse_intg_slug(slug: str) -> RecordID:
    return RecordID("integration", slug.strip().lower())


async def write_memory(
    memory_data: dict[str, Any],
    db: AsyncSurreal,
) -> RecordID | None:
    content = str(memory_data.get("content") or "").strip()
    if not content:
        return None

    mem_id = _memory_id(content)
    m_rec = _rec("memory", mem_id)

    tags = list(memory_data.get("tags") or [])
    confidence = float(memory_data.get("confidence") or 0.5)
    memory_type = str(memory_data.get("memory_type") or "fact")
    source_chat_ids: list[str] = list(memory_data.get("source_chat_ids") or [])
    about_integrations: list[str] = list(memory_data.get("about_integrations") or [])

    await db.query(
        """
        UPSERT $m MERGE {
            content: $content,
            memory_type: $mtype,
            confidence: $conf,
            tags: $tags,
            source: "enrichment",
            created_at: time::now(),
            updated_at: time::now()
        }
        """,
        {
            "m": m_rec,
            "content": content,
            "mtype": memory_type,
            "conf": confidence,
            "tags": tags,
        },
    )

    # chat_yields edges
    for chat_id_str in source_chat_ids:
        c_rec = _parse_chat_id(str(chat_id_str))
        if c_rec is None:
            continue
        try:
            await relate_unique(
                db, c_rec, "chat_yields", m_rec,
                {"confidence": confidence, "extracted_at": None},
            )
        except Exception as e:  # noqa: BLE001
            log.debug("chat_yields edge skipped (%s → %s): %s", chat_id_str, mem_id, e)

    # memory_about edges → integrations
    for slug in about_integrations:
        i_rec = _parse_intg_slug(slug)
        try:
            await relate_unique(db, m_rec, "memory_about", i_rec, {"relevance": confidence})
        except Exception as e:  # noqa: BLE001
            log.debug("memory_about(intg) edge skipped (%s → %s): %s", mem_id, slug, e)

    # memory_about edges → entities (by name lookup)
    for ent_info in memory_data.get("about_entities") or []:
        name = str(ent_info.get("name") or "").strip()
        if not name:
            continue
        try:
            res = await db.query(
                "SELECT id FROM entity WHERE name = $name LIMIT 1",
                {"name": name},
            )
            rows = res[0] if isinstance(res, list) and res else []
            if isinstance(rows, list) and rows:
                e_rec = rows[0].get("id")
                if e_rec:
                    await relate_unique(
                        db, m_rec, "memory_about", e_rec,
                        {"relevance": confidence * 0.9},
                    )
        except Exception as e:  # noqa: BLE001
            log.debug("memory_about(entity) skipped (%s): %s", name, e)

    log.info("Wrote memory %s (type=%s, conf=%.2f)", mem_id, memory_type, confidence)
    return m_rec
