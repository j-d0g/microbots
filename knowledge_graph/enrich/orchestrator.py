"""Enrichment orchestrator: runs memory → entity (parallel) → skills → workflows."""
from __future__ import annotations

import asyncio
import logging

from surrealdb.data.types.record_id import RecordID

from config import Config
from enrich.context import load_enrichment_context
from enrich.entity_resolver import resolve_entities
from enrich.memory_extractor import extract_memories
from enrich.skill_detector import detect_skills
from enrich.workflow_composer import compose_workflows
from ingest.db import surreal_session, unwrap_surreal_rows

log = logging.getLogger(__name__)


async def run_enrichment(
    new_chat_ids: list[RecordID],
    config: Config,
) -> dict[str, int]:
    async with surreal_session(config) as db:
        new_chats, old_summaries, existing_memories = await load_enrichment_context(
            db, new_chat_ids
        )

        if not new_chats:
            log.info("Enrichment: no chats to process, skipping")
            return {"memories": 0, "entities_resolved": 0, "skills": 0, "workflows": 0}

        # Step 1: Memory extraction + Entity resolution in parallel
        log.info("Enrichment step 1: memory extraction + entity resolution (parallel)")
        memory_count, entity_count = await asyncio.gather(
            extract_memories(new_chats, old_summaries, existing_memories, config, db),
            resolve_entities(new_chat_ids, config, db),
        )

        # Step 2: Skill detection (reads freshly written memories)
        log.info("Enrichment step 2: skill detection (two-pass)")
        res_mem = await db.query("SELECT id, content, memory_type, confidence FROM memory")
        all_memories = unwrap_surreal_rows(res_mem)
        skill_count = await detect_skills(new_chats, old_summaries, all_memories, config, db)

        # Step 3: Workflow composition (reads freshly written skills)
        log.info("Enrichment step 3: workflow composition")
        res_skills = await db.query("SELECT * FROM skill")
        all_skills = unwrap_surreal_rows(res_skills)
        workflow_count = await compose_workflows(all_skills, new_chats, old_summaries, config, db)

    return {
        "memories": memory_count,
        "entities_resolved": entity_count,
        "skills": skill_count,
        "workflows": workflow_count,
    }
