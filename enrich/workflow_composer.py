"""Workflow composition: finds multi-skill sequences and writes workflow records."""
from __future__ import annotations

import logging
from typing import Any

from surrealdb import AsyncSurreal

from config import Config
from enrich.llm import call_llm_json
from enrich.prompts import workflow as workflow_prompt
from enrich.writers.workflow_writer import write_workflow
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


async def compose_workflows(
    all_skills: list[dict[str, Any]],
    new_chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    config: Config,
    db: AsyncSurreal,
) -> int:
    if len(all_skills) < 2:
        log.info("Workflow composition: fewer than 2 skills, skipping")
        return 0

    cfg = config.enrichment
    skills_input = all_skills[: cfg.workflow_max_skills]
    chats_input = new_chats[: cfg.workflow_max_chat_context]
    old_input = old_summaries[:100]

    # Load integration metadata for co-usage context
    res = await db.query("SELECT slug, user_purpose, usage_patterns FROM integration")
    intg_meta = unwrap_surreal_rows(res)

    system = workflow_prompt.SYSTEM
    user = workflow_prompt.build_user_prompt(
        skills=skills_input,
        new_chats=chats_input,
        old_summaries=old_input,
        integration_metadata=intg_meta,
    )

    result = await call_llm_json(system, user, config, label="workflow_composition")
    if result is None:
        log.warning("Workflow composition failed")
        return 0

    total = 0
    for wf_data in result.get("workflows") or []:
        rec = await write_workflow(wf_data, db)
        if rec is not None:
            total += 1

    log.info("Workflow composition: %d workflows written", total)
    return total
