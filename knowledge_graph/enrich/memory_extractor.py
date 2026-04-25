"""Memory extraction: Pydantic AI agent reads chats, writes memory records with provenance edges."""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID

from config import Config
from enrich.context import group_chats_by_integration
from enrich.llm import enrich_model_settings, resolve_enrich_model
from enrich.prompts import memory as memory_prompt
from enrich.writers.memory_writer import write_memory
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic output models (match the JSON schema in memory prompt)
# ---------------------------------------------------------------------------

class EntityRef(BaseModel):
    name: str
    type: str = "person"


class MemoryItem(BaseModel):
    content: str
    memory_type: str = "fact"
    confidence: float = 0.5
    tags: list[str] = Field(default_factory=list)
    source_chat_ids: list[str] = Field(default_factory=list)
    about_entities: list[EntityRef] = Field(default_factory=list)
    about_integrations: list[str] = Field(default_factory=list)


class MemoryExtractionResult(BaseModel):
    memories: list[MemoryItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Agent builder
# ---------------------------------------------------------------------------

def build_memory_agent(config: Config) -> Agent[None, MemoryExtractionResult]:
    model_str = resolve_enrich_model(config)
    log.info("memory_extractor: using model %s", model_str)
    return Agent(
        model=model_str,
        output_type=MemoryExtractionResult,
        model_settings=enrich_model_settings(),
        system_prompt=memory_prompt.SYSTEM,
        retries=config.pipeline.max_retries,
    )


# ---------------------------------------------------------------------------
# Public entry point (same signature as before)
# ---------------------------------------------------------------------------

async def extract_memories(
    new_chats: list[dict[str, Any]],
    old_summaries: list[dict[str, Any]],
    existing_memories: list[dict[str, Any]],
    config: Config,
    db: AsyncSurreal,
) -> int:
    if not new_chats:
        return 0

    res = await db.query("SELECT in, out FROM chat_from")
    chat_from_rows = unwrap_surreal_rows(res)
    groups = group_chats_by_integration(new_chats, chat_from_rows)

    cfg = config.enrichment
    agent = build_memory_agent(config)
    total = 0

    for integration, chats in groups.items():
        for batch_start in range(0, len(chats), cfg.memory_max_new_chats_per_call):
            batch = chats[batch_start: batch_start + cfg.memory_max_new_chats_per_call]

            intg_old = [
                s for s in old_summaries
                if str(s.get("source_type", "")).lower().startswith(integration[:4])
            ][:cfg.memory_max_old_summaries_per_call]

            user = memory_prompt.build_user_prompt(
                integration=integration,
                new_chats=batch,
                old_summaries=intg_old,
                existing_memories=existing_memories,
            )

            try:
                result = await agent.run(user)
                extraction = result.output
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "Memory extraction failed for integration=%s: %s",
                    integration, e,
                )
                continue

            for mem in extraction.memories:
                mem_data = mem.model_dump()
                rec = await write_memory(mem_data, db)
                if rec is not None:
                    total += 1

    log.info("Memory extraction: %d memories written", total)
    return total
