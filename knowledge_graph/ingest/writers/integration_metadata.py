"""Merge behavioral metadata into integration nodes; stub key entities + appears_in."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

log = logging.getLogger(__name__)


def _entity_id_part(name: str, etype: str) -> str:
    h = hashlib.sha256(f"{name.lower()}|{etype}".encode()).hexdigest()[:28]
    return f"ingest_{h}"


async def write_integration_metadata(
    integration_slug: str, metadata: dict[str, Any], db: AsyncSurreal
) -> None:
    purpose = metadata.get("user_purpose") or ""
    patterns = list(metadata.get("usage_patterns") or [])
    tips = list(metadata.get("navigation_tips") or [])
    int_rec = RecordID("integration", integration_slug)
    await db.query(
        """
        UPDATE $i MERGE {
            user_purpose: $purpose,
            usage_patterns: array::union(usage_patterns ?? [], $patterns),
            navigation_tips: array::union(navigation_tips ?? [], $tips),
            updated_at: time::now()
        }
        """,
        {
            "i": int_rec,
            "purpose": purpose,
            "patterns": patterns,
            "tips": tips,
        },
    )
    for ent in metadata.get("key_entities") or []:
        if not isinstance(ent, dict) or not ent.get("name"):
            continue
        eid = _entity_id_part(str(ent["name"]), str(ent.get("type", "entity")))
        ename = str(ent["name"])[:500]
        etype = str(ent.get("type", "entity"))[:80]
        role = str(ent.get("role", ""))[:200]
        e_rec = RecordID("entity", eid)
        i_rec = RecordID("integration", integration_slug)
        await db.query(
            """
            UPSERT $e MERGE {
                name: $ename,
                entity_type: $etype,
                created_at: time::now(),
                updated_at: time::now()
            }
            """,
            {
                "e": e_rec,
                "ename": ename,
                "etype": etype,
            },
        )
        await db.query(
            """
            RELATE $e->appears_in->$i CONTENT {
                handle: $h,
                role: $role,
                context: "ingest: triage"
            }
            """,
            {
                "e": e_rec,
                "i": i_rec,
                "h": ename,
                "role": role,
            },
        )
    log.info("Updated integration metadata for %s", integration_slug)
