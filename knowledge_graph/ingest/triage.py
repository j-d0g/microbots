"""Batched triage: parallel LLM with retries and JSON validation."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import pydantic
from config import Config
from ingest.llm import call_llm
from ingest.prompts import integration_system_prompt
from ingest.prompts.core import build_user_payload
from ingest.pullers.base import RawItem

log = logging.getLogger(__name__)


def chunk(items: list[RawItem], n: int) -> list[list[RawItem]]:
    if n <= 0:
        n = 20
    return [items[i : i + n] for i in range(0, len(items), n)]


def _strip_json_fence(text: str) -> str:
    t = text.strip()
    m = re.match(
        r"^```(?:json)?\s*\n?(.*?)\n?```$", t, re.DOTALL | re.IGNORECASE
    )
    if m:
        return m.group(1).strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lower().startswith("json"):
            t = t[4:].lstrip()
    return t


class EntityMentionPyd(pydantic.BaseModel):
    name: str
    mention_type: str = "mentioned"


class ChatRecPyd(pydantic.BaseModel):
    model_config = pydantic.ConfigDict(extra="ignore")

    external_id: str = ""
    title: str = ""
    summary: str = ""
    content: str = ""
    signal_level: str = "mid"
    source_type: str = "ingest"
    occurred_at: str = ""
    entities_mentioned: list[EntityMentionPyd] = pydantic.Field(default_factory=list)


class KeyEntityPyd(pydantic.BaseModel):
    model_config = pydantic.ConfigDict(populate_by_name=True)

    name: str
    type: str = "person"  # noqa: A003
    role: str = ""


class IntegrationMetaPyd(pydantic.BaseModel):
    user_purpose: str = ""
    usage_patterns: list[str] = pydantic.Field(default_factory=list)
    navigation_tips: list[str] = pydantic.Field(default_factory=list)
    key_entities: list[KeyEntityPyd] = pydantic.Field(default_factory=list)


class TriagePyd(pydantic.BaseModel):
    integration_metadata: IntegrationMetaPyd
    chat_records: list[ChatRecPyd]
    items_dropped: list[str] = pydantic.Field(default_factory=list)


def validate_triage_output(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise TypeError("expected dict")
    data = obj
    _ = TriagePyd.model_validate(
        {**data, "items_dropped": data.get("items_dropped", [])}
    )
    return data


def _parse_triage_text(raw: str) -> dict[str, Any]:
    text = _strip_json_fence(raw)
    return json.loads(text)


async def triage_batch_with_retry(
    batch: list[RawItem], integration: str, config: Config
) -> dict[str, Any] | None:
    if not batch:
        return {
            "integration_metadata": {
                "user_purpose": "",
                "usage_patterns": [],
                "navigation_tips": [],
                "key_entities": [],
            },
            "chat_records": [],
            "items_dropped": [],
        }
    system = integration_system_prompt(integration)
    user = build_user_payload(batch)
    max_r = config.pipeline.max_retries
    for attempt in range(max_r):
        try:
            use_json = config.llm.provider == "openrouter"
            raw = await call_llm(
                system,
                f"Input JSON:\n{user}",
                config.llm,
                use_json_object=use_json,
                openrouter_api_key=config.openrouter_api_key,
                anthropic_api_key=config.anthropic_api_key,
            )
            parsed = _parse_triage_text(raw)
            return validate_triage_output(parsed)
        except (json.JSONDecodeError, TypeError) as e:
            log.warning(
                "Triage attempt %d/%d JSON fail: %s", attempt + 1, max_r, e
            )
        except pydantic.ValidationError as e:
            log.warning(
                "Triage attempt %d/%d validation fail: %s", attempt + 1, max_r, e
            )
        except Exception as e:  # noqa: BLE001
            log.error("Triage attempt %d unexpected: %s", attempt + 1, e)
        if attempt == max_r - 1:
            log.error("Triage failed for batch of %d after %d attempts", len(batch), max_r)
            return None
    return None


def _semaphore_run(
    n: int,
) -> tuple[asyncio.Semaphore, int]:
    return asyncio.Semaphore(max(1, n)), max(1, n)


async def parallel_triage(
    batches: list[list[RawItem]], integration: str, config: Config
) -> list[dict[str, Any] | None]:
    sem, _ = _semaphore_run(config.pipeline.parallel_llm_calls)

    async def one(b: list[RawItem]) -> dict[str, Any] | None:
        async with sem:
            return await triage_batch_with_retry(b, integration, config)

    return await asyncio.gather(*[one(b) for b in batches])
