"""Two-pass skill detection: per-integration map → cross-integration reduce."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from surrealdb import AsyncSurreal

from config import Config
from enrich.context import group_chats_by_integration
from enrich.llm import call_llm_json
from enrich.prompts import skill_per_integration as pass1_prompt
from enrich.prompts import skill_synthesis as pass2_prompt
from enrich.writers.skill_writer import write_skill
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


async def _pass1_integration(
    integration: str,
    chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    all_memories: list[dict[str, Any]],
    config: Config,
) -> dict[str, Any]:
    cfg = config.enrichment
    batch = chats[: cfg.skill_max_chats_per_integration]
    memories = all_memories[: cfg.skill_max_memories_per_integration]

    # Scope old summaries to this integration
    intg_old = [
        s for s in old_summaries
        if str(s.get("source_type", "")).lower().startswith(integration[:4])
    ][:200]

    system = pass1_prompt.build_system(integration)
    user = pass1_prompt.build_user_prompt(
        new_chats=batch,
        old_summaries=intg_old,
        memories=memories,
    )

    result = await call_llm_json(
        system, user, config, label=f"skill_pass1/{integration}"
    )
    if result is None:
        return {"integration": integration, "skills": [], "candidates_below_threshold": []}

    result["integration"] = integration
    return result


async def detect_skills(
    new_chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    all_memories: list[dict[str, Any]],
    config: Config,
    db: AsyncSurreal,
) -> int:
    if not new_chats:
        return 0

    # Group chats by integration
    res = await db.query("SELECT in, out FROM chat_from")
    chat_from_rows = unwrap_surreal_rows(res)
    groups = group_chats_by_integration(new_chats, chat_from_rows)

    if not groups:
        return 0

    # Pass 1: per-integration in parallel
    tasks = [
        _pass1_integration(intg, chats, old_summaries, all_memories, config)
        for intg, chats in groups.items()
    ]
    pass1_results: list[dict[str, Any]] = await asyncio.gather(*tasks)

    # Check if any Pass 1 produced skills
    all_candidates = [r for r in pass1_results if r.get("skills") or r.get("candidates_below_threshold")]
    if not all_candidates:
        log.info("Skill detection: no candidates from Pass 1")
        return 0

    # Pass 2: cross-integration synthesis
    cfg = config.enrichment
    synthesis_input = pass1_results[: cfg.skill_max_candidates_for_synthesis]

    system = pass2_prompt.SYSTEM
    user = pass2_prompt.build_user_prompt(synthesis_input)

    final_result = await call_llm_json(system, user, config, label="skill_pass2_synthesis")
    if final_result is None:
        log.warning("Skill synthesis (Pass 2) failed, falling back to Pass 1 results")
        # Fall back to whatever Pass 1 found
        final_skills = [s for r in pass1_results for s in r.get("skills") or []]
    else:
        final_skills = final_result.get("skills") or []

    # Filter to min strength
    min_s = config.enrichment.skill_min_strength
    final_skills = [s for s in final_skills if int(s.get("strength") or 0) >= min_s]

    total = 0
    for skill_data in final_skills:
        rec = await write_skill(skill_data, db)
        if rec is not None:
            total += 1

    log.info("Skill detection: %d skills written (min_strength=%d)", total, min_s)
    return total
