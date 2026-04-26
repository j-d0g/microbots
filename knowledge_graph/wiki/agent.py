"""WikiAgent — Pydantic AI agent for diff-updating the memory/ markdown layer."""
from __future__ import annotations

import logging
import os
from typing import Union

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from config import WikiConfig
from wiki.deps import WikiDeps
from wiki.prompts.system import SYSTEM_PROMPT
from wiki.tools import (
    tool_estimate_tokens,
    tool_list_markdown_tree,
    tool_query_graph,
    tool_read_markdown,
    tool_write_markdown,
)

log = logging.getLogger(__name__)

_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class WikiUpdate(BaseModel):
    """Structured output from one wiki agent invocation."""
    path: str
    content: str
    rationale: str
    tokens_used: int = 0


def _resolve_model(config: WikiConfig) -> Union[OpenAIChatModel, AnthropicModel, str]:
    """Build the Pydantic AI model object based on available API keys.

    Priority:
    1. OPENROUTER_API_KEY → OpenAIChatModel via OpenRouter (OpenAI-compatible)
    2. ANTHROPIC_API_KEY  → AnthropicModel
    3. Fallback           → plain string (openai:gpt-4.1-mini, needs OPENAI_API_KEY)
    """
    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_key:
        # Strip any "openrouter:" prefix that may have been stored in config
        model_name = config.openrouter_model.removeprefix("openrouter:")
        log.info("wiki: using OpenRouter model %s", model_name)
        return OpenAIChatModel(
            model_name,
            provider=OpenAIProvider(
                base_url=_OPENROUTER_BASE_URL,
                api_key=openrouter_key,
            ),
        )

    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if anthropic_key:
        model_name = "claude-haiku-4-5-20251001"
        log.info("wiki: using Anthropic model %s", model_name)
        return AnthropicModel(model_name)

    # Last resort: plain string — works if OPENAI_API_KEY is set
    log.warning(
        "wiki: no OPENROUTER_API_KEY or ANTHROPIC_API_KEY set; "
        "falling back to %s (requires OPENAI_API_KEY)",
        config.model,
    )
    return config.model


def build_wiki_agent(config: WikiConfig) -> Agent[WikiDeps, WikiUpdate]:
    """Construct the WikiAgent with all tools registered."""
    model = _resolve_model(config)

    # Cap max_tokens to fit OpenRouter's free-tier per-request budget.
    # See enrich/llm.py:enrich_model_settings for rationale.
    from enrich.llm import enrich_model_settings  # local import to avoid cycle

    agent: Agent[WikiDeps, WikiUpdate] = Agent(
        model=model,
        deps_type=WikiDeps,
        output_type=WikiUpdate,
        system_prompt=SYSTEM_PROMPT,
        retries=2,
        model_settings=enrich_model_settings(),
    )

    # Register tools
    agent.tool(tool_read_markdown, name="read_markdown")
    agent.tool(tool_write_markdown, name="write_markdown")
    agent.tool(tool_list_markdown_tree, name="list_markdown_tree")
    agent.tool(tool_query_graph, name="query_graph")
    agent.tool(tool_estimate_tokens, name="estimate_tokens")

    return agent
