"""Shared LLM helper for the enrichment layer: call_llm + JSON retry wrapper."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from config import Config
from ingest.llm import call_llm

log = logging.getLogger(__name__)

_JSON_FENCE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```$", re.DOTALL | re.IGNORECASE)


def _strip_fence(text: str) -> str:
    t = text.strip()
    m = _JSON_FENCE.match(t)
    if m:
        return m.group(1).strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lower().startswith("json"):
            t = t[4:].lstrip()
    return t


async def call_llm_json(
    system: str,
    user: str,
    config: Config,
    *,
    label: str = "enrichment",
) -> dict[str, Any] | None:
    """Call the configured LLM, retry up to max_retries, return parsed dict or None."""
    use_json = config.llm.provider == "openrouter"
    max_r = config.pipeline.max_retries

    for attempt in range(max_r):
        try:
            raw = await call_llm(
                system,
                user,
                config.llm,
                use_json_object=use_json,
                openrouter_api_key=config.openrouter_api_key,
                anthropic_api_key=config.anthropic_api_key,
            )
            return json.loads(_strip_fence(raw))
        except (json.JSONDecodeError, ValueError) as e:
            log.warning("[%s] attempt %d/%d JSON fail: %s", label, attempt + 1, max_r, e)
        except Exception as e:  # noqa: BLE001
            log.error("[%s] attempt %d/%d unexpected: %s", label, attempt + 1, max_r, e)

    log.error("[%s] all %d attempts failed", label, max_r)
    return None
