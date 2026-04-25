"""Create chat records with chat_from and chat_mentions edges."""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

log = logging.getLogger(__name__)

INVALID_ID = re.compile(r"[^a-zA-Z0-9_]")


def _chat_id_part(external_id: str) -> str:
    h = hashlib.sha256(external_id.encode()).hexdigest()[:40]
    return f"ingest_{h}"


def _entity_mention_id_part(name: str) -> str:
    n = re.sub(r"\s+", "_", name.lower().strip())[:40] or "unknown"
    n2 = INVALID_ID.sub("_", n)[:32]
    h = hashlib.sha256(name.encode()).hexdigest()[:12]
    return f"ingest_mention_{n2}_{h}"


def _parse_occurred(oa: str) -> str:
    if not oa or not str(oa).strip():
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return str(oa).replace("Z", "+00:00")[:200]


async def write_chat_record(
    record: dict[str, Any], integration_slug: str, db: AsyncSurreal
) -> RecordID:
    ext = record.get("external_id") or ""
    chat_part = _chat_id_part(str(ext))
    title = str(record.get("title") or "")[:500]
    content = str(record.get("content") or record.get("summary") or "")
    st = str(record.get("source_type") or "unknown")
    sl = str(record.get("signal_level") or "mid")
    su = str(record.get("summary") or "")[:2000]
    oa = _parse_occurred(str(record.get("occurred_at", "")))

    c_rec = RecordID("chat", chat_part)
    int_rec = RecordID("integration", integration_slug)
    await db.query(
        """
        UPSERT $c MERGE {
            title: $title,
            content: $content,
            source_type: $st,
            source_id: $sid,
            signal_level: $sl,
            summary: $su,
            occurred_at: type::datetime($oa),
            created_at: time::now()
        }
        """,
        {
            "c": c_rec,
            "title": title,
            "content": content,
            "st": st,
            "sid": str(ext),
            "sl": sl,
            "su": su,
            "oa": oa,
        },
    )
    await db.query(
        """
        RELATE $c->chat_from->$i
        """,
        {
            "c": c_rec,
            "i": int_rec,
        },
    )
    for ent in record.get("entities_mentioned") or []:
        if not isinstance(ent, dict) or not ent.get("name"):
            continue
        n = str(ent["name"])
        mt = str(ent.get("mention_type", "mentioned"))[:40]
        ep = _entity_mention_id_part(n)
        e_rec = RecordID("entity", ep)
        await db.query(
            """
            UPSERT $e MERGE {
                name: $n,
                entity_type: "person",
                created_at: time::now(),
                updated_at: time::now()
            }
            """,
            {
                "e": e_rec,
                "n": n[:500],
            },
        )
        await db.query(
            """
            RELATE $c->chat_mentions->$e SET mention_type = $mt
            """,
            {
                "c": c_rec,
                "e": e_rec,
                "mt": mt,
            },
        )
    log.info("Wrote chat type::thing('chat', %s)", chat_part)
    return c_rec
