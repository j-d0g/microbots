"""Memory extraction: LLM reads chats, writes memory records with provenance edges."""
from __future__ import annotations

import logging
from typing import Any

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from config import Config
from enrich.context import group_chats_by_integration
from enrich.llm import call_llm_json
from enrich.prompts import memory as memory_prompt
from enrich.writers.memory_writer import write_memory
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


async def extract_memories(
    new_chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    existing_memories: list[dict[str, Any]],
    config: Config,
    db: AsyncSurreal,
) -> int:
    if not new_chats:
        return 0

    # Load chat_from edges to group by integration
    res = await db.query("SELECT in, out FROM chat_from")
    chat_from_rows = unwrap_surreal_rows(res)
    groups = group_chats_by_integration(new_chats, chat_from_rows)

    cfg = config.enrichment
    total = 0

    for integration, chats in groups.items():
        # Batch if over threshold
        for batch_start in range(0, len(chats), cfg.memory_max_new_chats_per_call):
            batch = chats[batch_start: batch_start + cfg.memory_max_new_chats_per_call]

            # Old summaries scoped to this integration (best-effort)
            intg_old = [
                s for s in old_summaries
                if str(s.get("source_type", "")).lower().startswith(integration[:4])
            ][:cfg.memory_max_old_summaries_per_call]

            system = memory_prompt.SYSTEM
            user = memory_prompt.build_user_prompt(
                integration=integration,
                new_chats=batch,
                old_summaries=intg_old,
                existing_memories=existing_memories,
            )

            result = await call_llm_json(
                system, user, config, label=f"memory/{integration}"
            )
            if result is None:
                log.warning("Memory extraction failed for integration=%s", integration)
                continue

            for mem_data in result.get("memories") or []:
                rec = await write_memory(mem_data, db)
                if rec is not None:
                    total += 1

    log.info("Memory extraction: %d memories written", total)
    return total
