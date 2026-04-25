"""Entity resolution: Pydantic AI agent merges stubs, enriches descriptions, creates edges."""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from config import Config
from enrich.llm import enrich_model_settings, resolve_enrich_model
from enrich.prompts import entity as entity_prompt
from enrich.writers.entity_writer import write_entity_resolution
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic output models (match the JSON schema in entity prompt)
# ---------------------------------------------------------------------------

class IntegrationMapping(BaseModel):
    slug: str
    handle: str = ""
    role: str = ""


class Relationship(BaseModel):
    target_name: str
    target_type: str = "person"
    relationship_type: str = ""
    context: str = ""


class ResolvedEntity(BaseModel):
    canonical_id: str = ""
    name: str
    entity_type: str = "person"
    description: str = ""
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    merge_ids: list[str] = Field(default_factory=list)
    integrations: list[IntegrationMapping] = Field(default_factory=list)
    relationships: list[Relationship] = Field(default_factory=list)


class EntityResolutionResult(BaseModel):
    entities: list[ResolvedEntity] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Agent builder
# ---------------------------------------------------------------------------

def build_entity_agent(config: Config) -> Agent[None, EntityResolutionResult]:
    model_str = resolve_enrich_model(config)
    log.info("entity_resolver: using model %s", model_str)
    return Agent(
        model=model_str,
        output_type=EntityResolutionResult,
        model_settings=enrich_model_settings(),
        system_prompt=entity_prompt.SYSTEM,
        retries=config.pipeline.max_retries,
    )


# ---------------------------------------------------------------------------
# Public entry point (same signature as before)
# ---------------------------------------------------------------------------

async def resolve_entities(
    new_chat_ids: list[RecordID],
    config: Config,
    db: AsyncSurreal,
) -> int:
    res_stubs = await db.query("SELECT * FROM entity")
    stubs = unwrap_surreal_rows(res_stubs)
    if not stubs:
        return 0

    res_ai = await db.query("SELECT in, out, handle, role FROM appears_in")
    appears_in_rows = unwrap_surreal_rows(res_ai)

    chat_context: list[dict[str, Any]] = []
    if new_chat_ids:
        res_ctx = await db.query(
            "SELECT id, title, source_type, summary FROM chat WHERE id IN $ids",
            {"ids": new_chat_ids},
        )
        chat_context = unwrap_surreal_rows(res_ctx)

    cfg = config.enrichment
    agent = build_entity_agent(config)
    total = 0

    for batch_start in range(0, len(stubs), cfg.entity_max_stubs_per_call):
        batch = stubs[batch_start: batch_start + cfg.entity_max_stubs_per_call]

        batch_ids = {str(e.get("id", "")) for e in batch}
        batch_ai = [r for r in appears_in_rows if str(r.get("in", "")) in batch_ids]

        user = entity_prompt.build_user_prompt(
            entity_stubs=batch,
            appears_in_rows=batch_ai,
            chat_context=chat_context[: cfg.entity_max_chat_context],
        )

        try:
            result = await agent.run(user)
            resolution = result.output
        except Exception as e:  # noqa: BLE001
            log.warning("Entity resolution failed for batch starting at %d: %s", batch_start, e)
            continue

        for ent in resolution.entities:
            ent_data = ent.model_dump()
            ok = await write_entity_resolution(ent_data, db)
            if ok:
                total += 1

    log.info("Entity resolution: %d entities resolved/enriched", total)
    return total
