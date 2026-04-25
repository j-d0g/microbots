"""Write entity resolution: merge stubs, enrich, create appears_in + related_to_entity edges."""
from __future__ import annotations

import logging
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from ingest.db import relate_unique, unwrap_surreal_rows

log = logging.getLogger(__name__)


def _parse_record_id(val: Any) -> RecordID | None:
    if isinstance(val, RecordID):
        return val
    s = str(val).strip()
    if ":" in s:
        table, _, id_part = s.partition(":")
        return RecordID(table.strip(), id_part.strip())
    return None


async def _get_entity_by_id(db: AsyncSurreal, entity_id_str: str) -> dict[str, Any] | None:
    rid = _parse_record_id(entity_id_str)
    if rid is None:
        return None
    try:
        res = await db.query("SELECT * FROM $e LIMIT 1", {"e": rid})
        rows = unwrap_surreal_rows(res)
        return rows[0] if rows else None
    except Exception:  # noqa: BLE001
        return None


async def _reassign_chat_mentions(db: AsyncSurreal, merged: RecordID, canonical: RecordID) -> None:
    """Re-point chat_mentions edges from merged → canonical entity."""
    try:
        res = await db.query(
            "SELECT id, in, mention_type FROM chat_mentions WHERE out = $merged",
            {"merged": merged},
        )
        rows = unwrap_surreal_rows(res)
        for row in rows:
            c_rec = row.get("in")
            mt = row.get("mention_type", "mentioned")
            if c_rec:
                await relate_unique(
                    db, c_rec, "chat_mentions", canonical, {"mention_type": mt}
                )
        await db.query("DELETE chat_mentions WHERE out = $merged", {"merged": merged})
    except Exception as e:  # noqa: BLE001
        log.debug("chat_mentions reassign failed (%s): %s", merged, e)


async def _reassign_related_to_entity(db: AsyncSurreal, merged: RecordID, canonical: RecordID) -> None:
    """Re-point related_to_entity edges both directions."""
    try:
        res = await db.query(
            "SELECT id, out, relationship_type, context FROM related_to_entity WHERE in = $merged",
            {"merged": merged},
        )
        for row in unwrap_surreal_rows(res):
            out_rec = row.get("out")
            if out_rec and str(out_rec) != str(canonical):
                await relate_unique(
                    db, canonical, "related_to_entity", out_rec,
                    {"relationship_type": row.get("relationship_type", ""), "context": row.get("context", "")},
                )
        res2 = await db.query(
            "SELECT id, in, relationship_type, context FROM related_to_entity WHERE out = $merged",
            {"merged": merged},
        )
        for row in unwrap_surreal_rows(res2):
            in_rec = row.get("in")
            if in_rec and str(in_rec) != str(canonical):
                await relate_unique(
                    db, in_rec, "related_to_entity", canonical,
                    {"relationship_type": row.get("relationship_type", ""), "context": row.get("context", "")},
                )
        await db.query(
            "DELETE related_to_entity WHERE in = $merged OR out = $merged",
            {"merged": merged},
        )
    except Exception as e:  # noqa: BLE001
        log.debug("related_to_entity reassign failed (%s): %s", merged, e)


async def write_entity_resolution(
    entity_data: dict[str, Any],
    db: AsyncSurreal,
) -> bool:
    """Merge, enrich, and write edges for one resolved entity. Returns True on success."""
    canonical_id_str = str(entity_data.get("canonical_id") or "").strip()
    name = str(entity_data.get("name") or "").strip()
    if not name:
        return False

    # Resolve canonical record
    canonical_rec: RecordID | None = _parse_record_id(canonical_id_str)
    if canonical_rec is None or canonical_rec.table_name not in ("entity",):
        # LLM gave a name not an ID — try finding by name
        try:
            res = await db.query(
                "SELECT id FROM entity WHERE name = $name LIMIT 1", {"name": name}
            )
            rows = unwrap_surreal_rows(res)
            if rows:
                canonical_rec = _parse_record_id(rows[0].get("id"))
        except Exception:  # noqa: BLE001
            pass

    if canonical_rec is None:
        log.warning("entity_writer: cannot resolve canonical for '%s', skipping", name)
        return False

    # Enrich canonical entity
    entity_type = str(entity_data.get("entity_type") or "person")
    description = str(entity_data.get("description") or "")
    aliases = list(entity_data.get("aliases") or [])
    tags = list(entity_data.get("tags") or [])
    try:
        await db.query(
            """
            UPSERT $e MERGE {
                name: $name,
                entity_type: $etype,
                description: $desc,
                aliases: $aliases,
                tags: $tags,
                updated_at: time::now()
            }
            """,
            {
                "e": canonical_rec,
                "name": name,
                "etype": entity_type,
                "desc": description,
                "aliases": aliases,
                "tags": tags,
            },
        )
    except Exception as e:  # noqa: BLE001
        log.error("entity enrich failed for %s: %s", name, e)
        return False

    # Merge duplicate stubs
    for merge_id_str in entity_data.get("merge_ids") or []:
        merged_rec = _parse_record_id(str(merge_id_str))
        if merged_rec is None or str(merged_rec) == str(canonical_rec):
            continue
        log.info("Merging %s → %s", merged_rec, canonical_rec)
        await _reassign_chat_mentions(db, merged_rec, canonical_rec)
        await _reassign_related_to_entity(db, merged_rec, canonical_rec)
        try:
            await db.query("DELETE appears_in WHERE in = $merged", {"merged": merged_rec})
            await db.query("DELETE memory_about WHERE out = $merged", {"merged": merged_rec})
            await db.query("DELETE indexed_by WHERE in = $merged", {"merged": merged_rec})
            await db.query("DELETE $merged", {"merged": merged_rec})
        except Exception as e:  # noqa: BLE001
            log.debug("merge cleanup failed (%s): %s", merged_rec, e)

    # Create/update appears_in edges
    for intg_info in entity_data.get("integrations") or []:
        slug = str(intg_info.get("slug") or "").strip().lower()
        if not slug:
            continue
        i_rec = RecordID("integration", slug)
        handle = str(intg_info.get("handle") or "")
        role = str(intg_info.get("role") or "")
        try:
            await relate_unique(
                db, canonical_rec, "appears_in", i_rec,
                {"handle": handle, "role": role},
            )
        except Exception as ex:  # noqa: BLE001
            log.debug("appears_in failed (%s → %s): %s", name, slug, ex)

    # Create related_to_entity edges
    for rel in entity_data.get("relationships") or []:
        target_name = str(rel.get("target_name") or "").strip()
        rel_type = str(rel.get("relationship_type") or "collaborates_with")
        context = str(rel.get("context") or "")
        if not target_name:
            continue
        try:
            res = await db.query(
                "SELECT id FROM entity WHERE name = $name LIMIT 1", {"name": target_name}
            )
            rows = unwrap_surreal_rows(res)
            if rows:
                t_rec = _parse_record_id(rows[0].get("id"))
                if t_rec and str(t_rec) != str(canonical_rec):
                    await relate_unique(
                        db, canonical_rec, "related_to_entity", t_rec,
                        {"relationship_type": rel_type, "context": context},
                    )
        except Exception as ex:  # noqa: BLE001
            log.debug("related_to_entity failed (%s → %s): %s", name, target_name, ex)

    log.info("Resolved entity '%s' (%s)", name, canonical_rec)
    return True
