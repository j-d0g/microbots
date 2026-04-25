"""Vanilla OpenRouter and Anthropic calls — no agent framework."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx
from anthropic import AsyncAnthropic
from config import LLMConfig

log = logging.getLogger(__name__)


def _get_openrouter_headers(api_key: str | None) -> dict[str, str]:
    key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
    h = {
        "Authorization": f"Bearer {key}",
    }
    ref = os.getenv("OPENROUTER_HTTP_REFERER", "https://github.com/j-d0g/microbots")
    title = os.getenv("OPENROUTER_X_TITLE", "microbots")
    h["HTTP-Referer"] = ref
    h["X-Title"] = title
    return h


def _message_content_anthropic(resp: Any) -> str:
    for b in resp.content:
        if getattr(b, "type", None) == "text" and hasattr(b, "text"):
            return b.text
    if resp.content and hasattr(resp.content[0], "text"):
        return resp.content[0].text
    return ""


async def call_llm(
    system: str,
    user: str,
    llm: LLMConfig,
    *,
    use_json_object: bool = True,
    openrouter_api_key: str | None = None,
    anthropic_api_key: str | None = None,
) -> str:
    okey = openrouter_api_key or os.getenv("OPENROUTER_API_KEY")
    akey = anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")
    if not okey and llm.provider == "openrouter":
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    if not akey and llm.provider == "anthropic":
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    if llm.provider == "openrouter":
        async with httpx.AsyncClient(timeout=120.0) as client:
            body: dict[str, Any] = {
                "model": llm.openrouter_model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": llm.max_tokens,
                "temperature": llm.temperature,
            }
            if use_json_object:
                body["response_format"] = {"type": "json_object"}
            r = await client.post(
                f"{llm.openrouter_base_url.rstrip('/')}/chat/completions",
                headers=_get_openrouter_headers(okey),
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            log.error("OpenRouter unexpected: %s", data)
            raise ValueError("bad OpenRouter response") from e

    client = AsyncAnthropic(api_key=akey or "")
    resp = await client.messages.create(
        model=llm.anthropic_model,
        max_tokens=llm.max_tokens,
        temperature=llm.temperature,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return _message_content_anthropic(resp)


