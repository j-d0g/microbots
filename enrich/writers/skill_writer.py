"""Write skill records, skill_derived_from edges, skill_uses edges."""
from __future__ import annotations

import logging
import re
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from ingest.db import relate_unique

log = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    return _SLUG_RE.sub("_", name.lower()).strip("_")[:64]


def _parse_record_id(val: Any) -> RecordID | None:
    s = str(val).strip()
    if ":" in s:
        table, _, id_part = s.partition(":")
        return RecordID(table.strip(), id_part.strip())
    return None


async def write_skill(
    skill_data: dict[str, Any],
    db: AsyncSurreal,
) -> RecordID | None:
    name = str(skill_data.get("name") or "").strip()
    slug = str(skill_data.get("slug") or _slugify(name)).strip()
    slug = _SLUG_RE.sub("_", slug.lower()).strip("_")[:64]
    if not slug:
        return None

    description = str(skill_data.get("description") or name)
    steps: list[str] = list(skill_data.get("steps") or [])
    strength = int(skill_data.get("strength") or 1)
    frequency = str(skill_data.get("frequency") or "ad-hoc")
    tags: list[str] = list(skill_data.get("tags") or [])
    # Encode strength in tags for observability
    tags = [t for t in tags if not t.startswith("strength:")] + [f"strength:{strength}"]
    integrations_used: list[str] = list(skill_data.get("integrations_used") or [])
    evidence_chat_ids: list[str] = list(skill_data.get("evidence_chat_ids") or [])
    evidence_memory_ids: list[str] = list(skill_data.get("evidence_memory_ids") or [])

    s_rec = RecordID("skill", slug)

    await db.query(
        """
        UPSERT $s MERGE {
            name: $name,
            slug: $slug,
            description: $desc,
            steps: $steps,
            frequency: $freq,
            tags: $tags,
            created_at: time::now(),
            updated_at: time::now()
        }
        """,
        {
            "s": s_rec,
            "name": name,
            "slug": slug,
            "desc": description,
            "steps": steps,
            "freq": frequency,
            "tags": tags,
        },
    )

    # skill_derived_from edges (chat provenance)
    for chat_id_str in evidence_chat_ids:
        c_rec = _parse_record_id(str(chat_id_str))
        if c_rec is None:
            continue
        try:
            await relate_unique(db, s_rec, "skill_derived_from", c_rec)
        except Exception as e:  # noqa: BLE001
            log.debug("skill_derived_from(chat) skipped (%s → %s): %s", slug, chat_id_str, e)

    # skill_derived_from edges (memory provenance)
    for mem_id_str in evidence_memory_ids:
        m_rec = _parse_record_id(str(mem_id_str))
        if m_rec is None:
            continue
        try:
            await relate_unique(db, s_rec, "skill_derived_from", m_rec)
        except Exception as e:  # noqa: BLE001
            log.debug("skill_derived_from(memory) skipped (%s → %s): %s", slug, mem_id_str, e)

    # skill_uses edges
    for intg_slug in integrations_used:
        i_rec = RecordID("integration", intg_slug.strip().lower())
        try:
            await relate_unique(db, s_rec, "skill_uses", i_rec)
        except Exception as e:  # noqa: BLE001
            log.debug("skill_uses skipped (%s → %s): %s", slug, intg_slug, e)

    log.info("Wrote skill '%s' (strength=%d, integrations=%s)", slug, strength, integrations_used)
    return s_rec
