"""Model selection and request settings shared by enrichment agents."""
from __future__ import annotations

import os
from pydantic_ai.models import Model

from config import Config


def resolve_enrich_model(config: Config) -> str | Model:
    """Pick the pydantic_ai model string for enrichment agents.

    Priority mirrors wiki/agent.py:
    1. OPENROUTER_API_KEY  → ``openrouter:<openrouter_model>``
    2. ANTHROPIC_API_KEY   → ``anthropic:<anthropic_model>``
    3. Fallback            → ``openai:gpt-4.1-mini``
    """
    if config.offline:
        from offline import model as demo_model
        return demo_model()
    if os.getenv("OPENROUTER_API_KEY"):
        model = config.llm.openrouter_model
        return model if model.startswith("openrouter:") else f"openrouter:{model}"
    if os.getenv("ANTHROPIC_API_KEY"):
        model = config.llm.anthropic_model
        return model if model.startswith("anthropic:") else f"anthropic:{model}"
    return "openai:gpt-4.1-mini"


def enrich_model_settings() -> dict:
    """ModelSettings dict shared by every enrichment / wiki Agent.

    Caps ``max_tokens`` so requests fit within OpenRouter's free-tier
    per-request budget. Free accounts get a small floating ceiling
    (~10–12k tokens depending on remaining credit). 8000 leaves headroom
    while staying generous enough for the structured JSON outputs we
    produce. Override via ``ENRICH_MAX_TOKENS`` env var if you've added
    paid credit.
    """
    return {"max_tokens": int(os.getenv("ENRICH_MAX_TOKENS", "8000"))}
