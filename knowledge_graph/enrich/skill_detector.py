"""Two-pass skill detection: Pydantic AI agents for per-integration map → cross-integration reduce."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from surrealdb import AsyncSurreal

from config import Config
from enrich.context import group_chats_by_integration
from enrich.llm import enrich_model_settings, resolve_enrich_model
from enrich.prompts import skill_per_integration as pass1_prompt
from enrich.prompts import skill_synthesis as pass2_prompt
from enrich.writers.skill_writer import write_skill
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic output models
# ---------------------------------------------------------------------------

class SkillCandidate(BaseModel):
    name: str
    slug: str = ""
    description: str = ""
    steps: list[str] = Field(default_factory=list)
    strength: int = 1
    frequency: str = "ad-hoc"
    tags: list[str] = Field(default_factory=list)
    integrations_used: list[str] = Field(default_factory=list)
    evidence_chat_ids: list[str] = Field(default_factory=list)
    evidence_memory_ids: list[str] = Field(default_factory=list)


class BelowThresholdCandidate(BaseModel):
    name: str
    observation_count: int = 1
    reason_excluded: str = ""
    evidence_chat_ids: list[str] = Field(default_factory=list)


class SkillPass1Result(BaseModel):
    skills: list[SkillCandidate] = Field(default_factory=list)
    candidates_below_threshold: list[BelowThresholdCandidate] = Field(default_factory=list)


class SkillSynthesisResult(BaseModel):
    skills: list[SkillCandidate] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Agent builders
# ---------------------------------------------------------------------------

def _build_pass1_agent(config: Config, integration: str) -> Agent[None, SkillPass1Result]:
    model_str = resolve_enrich_model(config)
    return Agent(
        model=model_str,
        output_type=SkillPass1Result,
        model_settings=enrich_model_settings(),
        system_prompt=pass1_prompt.build_system(integration),
        retries=config.pipeline.max_retries,
    )


def _build_pass2_agent(config: Config) -> Agent[None, SkillSynthesisResult]:
    model_str = resolve_enrich_model(config)
    return Agent(
        model=model_str,
        output_type=SkillSynthesisResult,
        model_settings=enrich_model_settings(),
        system_prompt=pass2_prompt.SYSTEM,
        retries=config.pipeline.max_retries,
    )


# ---------------------------------------------------------------------------
# Internal: Pass 1 per-integration
# ---------------------------------------------------------------------------

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

    intg_old = [
        s for s in old_summaries
        if str(s.get("source_type", "")).lower().startswith(integration[:4])
    ][:200]

    user = pass1_prompt.build_user_prompt(
        new_chats=batch,
        old_summaries=intg_old,
        memories=memories,
    )

    agent = _build_pass1_agent(config, integration)

    try:
        result = await agent.run(user)
        output = result.output.model_dump()
    except Exception as e:  # noqa: BLE001
        log.warning("skill_pass1/%s failed: %s", integration, e)
        return {"integration": integration, "skills": [], "candidates_below_threshold": []}

    output["integration"] = integration
    return output


# ---------------------------------------------------------------------------
# Public entry point (same signature as before)
# ---------------------------------------------------------------------------

async def detect_skills(
    new_chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    all_memories: list[dict[str, Any]],
    config: Config,
    db: AsyncSurreal,
) -> int:
    if not new_chats:
        return 0

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

    all_candidates = [r for r in pass1_results if r.get("skills") or r.get("candidates_below_threshold")]
    if not all_candidates:
        log.info("Skill detection: no candidates from Pass 1")
        return 0

    # Pass 2: cross-integration synthesis
    cfg = config.enrichment
    synthesis_input = pass1_results[: cfg.skill_max_candidates_for_synthesis]

    user = pass2_prompt.build_user_prompt(synthesis_input)
    agent2 = _build_pass2_agent(config)

    try:
        result = await agent2.run(user)
        final_skills = [s.model_dump() for s in result.output.skills]
    except Exception as e:  # noqa: BLE001
        log.warning("Skill synthesis (Pass 2) failed: %s, falling back to Pass 1 results", e)
        final_skills = [s for r in pass1_results for s in r.get("skills") or []]

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
