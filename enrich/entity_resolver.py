"""Entity resolution: merge stubs, enrich descriptions, create relationship edges."""
from __future__ import annotations

import logging
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from config import Config
from enrich.llm import call_llm_json
from enrich.prompts import entity as entity_prompt
from enrich.writers.entity_writer import write_entity_resolution
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


async def resolve_entities(
    new_chat_ids: list[RecordID],
    config: Config,
    db: AsyncSurreal,
) -> int:
    # Load all entity stubs
    res_stubs = await db.query("SELECT * FROM entity")
    stubs = unwrap_surreal_rows(res_stubs)
    if not stubs:
        return 0

    # Load appears_in edges
    res_ai = await db.query("SELECT in, out, handle, role FROM appears_in")
    appears_in_rows = unwrap_surreal_rows(res_ai)

    # Load chat context: chats mentioning any entity, scoped to new chats
    chat_context: list[dict[str, Any]] = []
    if new_chat_ids:
        res_ctx = await db.query(
            "SELECT id, title, source_type, summary FROM chat WHERE id IN $ids",
            {"ids": new_chat_ids},
        )
        chat_context = unwrap_surreal_rows(res_ctx)

    cfg = config.enrichment
    total = 0

    # Batch entity stubs
    for batch_start in range(0, len(stubs), cfg.entity_max_stubs_per_call):
        batch = stubs[batch_start: batch_start + cfg.entity_max_stubs_per_call]

        # Scope appears_in to entities in this batch
        batch_ids = {str(e.get("id", "")) for e in batch}
        batch_ai = [r for r in appears_in_rows if str(r.get("in", "")) in batch_ids]

        system = entity_prompt.SYSTEM
        user = entity_prompt.build_user_prompt(
            entity_stubs=batch,
            appears_in_rows=batch_ai,
            chat_context=chat_context[: cfg.entity_max_chat_context],
        )

        result = await call_llm_json(
            system, user, config, label="entity_resolution"
        )
        if result is None:
            log.warning("Entity resolution failed for batch starting at %d", batch_start)
            continue

        for ent_data in result.get("entities") or []:
            ok = await write_entity_resolution(ent_data, db)
            if ok:
                total += 1

    log.info("Entity resolution: %d entities resolved/enriched", total)
    return total
