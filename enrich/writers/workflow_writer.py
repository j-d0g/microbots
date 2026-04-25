"""Write workflow records and all associated edges."""
from __future__ import annotations

import logging
import re
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from ingest.db import relate_unique, unwrap_surreal_rows

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


async def write_workflow(
    workflow_data: dict[str, Any],
    db: AsyncSurreal,
) -> RecordID | None:
    name = str(workflow_data.get("name") or "").strip()
    slug = str(workflow_data.get("slug") or _slugify(name)).strip()
    slug = _SLUG_RE.sub("_", slug.lower()).strip("_")[:64]
    if not slug:
        return None

    description = str(workflow_data.get("description") or name)
    trigger = str(workflow_data.get("trigger") or "")
    outcome = str(workflow_data.get("outcome") or "")
    frequency = str(workflow_data.get("frequency") or "ad-hoc")
    tags: list[str] = list(workflow_data.get("tags") or [])
    skill_sequence: list[dict] = list(workflow_data.get("skill_sequence") or [])
    integrations_used: list[str] = list(workflow_data.get("integrations_used") or [])
    entities_involved: list[dict] = list(workflow_data.get("entities_involved") or [])
    evidence_chat_ids: list[str] = list(workflow_data.get("evidence_chat_ids") or [])

    if len(skill_sequence) < 2:
        log.warning("Workflow '%s' has < 2 skills, skipping", slug)
        return None

    wf_rec = RecordID("workflow", slug)

    await db.query(
        """
        UPSERT $w MERGE {
            name: $name,
            slug: $slug,
            description: $desc,
            trigger: $trigger,
            outcome: $outcome,
            frequency: $freq,
            tags: $tags,
            created_at: time::now(),
            updated_at: time::now()
        }
        """,
        {
            "w": wf_rec,
            "name": name,
            "slug": slug,
            "desc": description,
            "trigger": trigger,
            "outcome": outcome,
            "freq": frequency,
            "tags": tags,
        },
    )

    # workflow_contains_skill edges (ordered)
    # Uniqueness key = (in, out, step_order) — re-enrichment may change ordering.
    for step in skill_sequence:
        skill_slug = str(step.get("skill_slug") or "").strip()
        step_order = int(step.get("step_order") or 0)
        optional = bool(step.get("optional") or False)
        if not skill_slug:
            continue
        s_rec = RecordID("skill", skill_slug)
        try:
            # Check for existing edge with the same (in, out, step_order) triple.
            existing = await db.query(
                "SELECT id FROM workflow_contains_skill "
                "WHERE in = $f AND out = $t AND step_order = $o LIMIT 1",
                {"f": wf_rec, "t": s_rec, "o": step_order},
            )
            if unwrap_surreal_rows(existing):
                continue
            await db.query(
                "RELATE $f->workflow_contains_skill->$t CONTENT $c",
                {"f": wf_rec, "t": s_rec, "c": {"step_order": step_order, "optional": optional}},
            )
        except Exception as e:  # noqa: BLE001
            log.debug("workflow_contains_skill skipped (%s → %s): %s", slug, skill_slug, e)

    # workflow_uses edges
    for intg_slug in integrations_used:
        i_rec = RecordID("integration", intg_slug.strip().lower())
        try:
            await relate_unique(db, wf_rec, "workflow_uses", i_rec)
        except Exception as e:  # noqa: BLE001
            log.debug("workflow_uses skipped (%s → %s): %s", slug, intg_slug, e)

    # workflow_involves edges (entity by name lookup)
    for ent_info in entities_involved:
        ent_name = str(ent_info.get("name") or "").strip()
        role = str(ent_info.get("role") or "")
        if not ent_name:
            continue
        try:
            res = await db.query(
                "SELECT id FROM entity WHERE name = $name LIMIT 1", {"name": ent_name}
            )
            rows = unwrap_surreal_rows(res)
            if rows:
                e_rec = _parse_record_id(rows[0].get("id"))
                if e_rec:
                    await relate_unique(
                        db, wf_rec, "workflow_involves", e_rec, {"role": role}
                    )
        except Exception as e:  # noqa: BLE001
            log.debug("workflow_involves skipped (%s → %s): %s", slug, ent_name, e)

    # memory_informs edges: load memories that cover these chats and point to workflow
    if evidence_chat_ids:
        try:
            chat_recs = [_parse_record_id(c) for c in evidence_chat_ids if _parse_record_id(c)]
            if chat_recs:
                res = await db.query(
                    "SELECT out FROM chat_yields WHERE in IN $chats",
                    {"chats": chat_recs},
                )
                for row in unwrap_surreal_rows(res):
                    m_rec = _parse_record_id(row.get("out"))
                    if m_rec:
                        await relate_unique(db, m_rec, "memory_informs", wf_rec)
        except Exception as e:  # noqa: BLE001
            log.debug("memory_informs(workflow) skipped: %s", e)

    log.info("Wrote workflow '%s' (%d steps)", slug, len(skill_sequence))
    return wf_rec
