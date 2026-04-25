"""Workflow composition: Pydantic AI agent finds multi-skill sequences and writes workflow records."""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from surrealdb import AsyncSurreal

from config import Config
from enrich.llm import resolve_enrich_model
from enrich.prompts import workflow as workflow_prompt
from enrich.writers.workflow_writer import write_workflow
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic output models (match the JSON schema in workflow prompt)
# ---------------------------------------------------------------------------

class SkillStep(BaseModel):
    skill_slug: str
    step_order: int = 1
    optional: bool = False


class WorkflowEntity(BaseModel):
    name: str
    type: str = "person"
    role: str = ""


class WorkflowItem(BaseModel):
    name: str
    slug: str = ""
    description: str = ""
    trigger: str = ""
    outcome: str = ""
    frequency: str = "ad-hoc"
    tags: list[str] = Field(default_factory=list)
    skill_sequence: list[SkillStep] = Field(default_factory=list)
    integrations_used: list[str] = Field(default_factory=list)
    entities_involved: list[WorkflowEntity] = Field(default_factory=list)
    evidence_chat_ids: list[str] = Field(default_factory=list)


class WorkflowCompositionResult(BaseModel):
    workflows: list[WorkflowItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Agent builder
# ---------------------------------------------------------------------------

def build_workflow_agent(config: Config) -> Agent[None, WorkflowCompositionResult]:
    model_str = resolve_enrich_model(config)
    log.info("workflow_composer: using model %s", model_str)
    return Agent(
        model=model_str,
        output_type=WorkflowCompositionResult,
        system_prompt=workflow_prompt.SYSTEM,
        retries=config.pipeline.max_retries,
    )


# ---------------------------------------------------------------------------
# Public entry point (same signature as before)
# ---------------------------------------------------------------------------

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

    res = await db.query("SELECT slug, user_purpose, usage_patterns FROM integration")
    intg_meta = unwrap_surreal_rows(res)

    user = workflow_prompt.build_user_prompt(
        skills=skills_input,
        new_chats=chats_input,
        old_summaries=old_input,
        integration_metadata=intg_meta,
    )

    agent = build_workflow_agent(config)

    try:
        result = await agent.run(user)
        composition = result.output
    except Exception as e:  # noqa: BLE001
        log.warning("Workflow composition failed: %s", e)
        return 0

    total = 0
    for wf in composition.workflows:
        wf_data = wf.model_dump()
        rec = await write_workflow(wf_data, db)
        if rec is not None:
            total += 1

    log.info("Workflow composition: %d workflows written", total)
    return total
