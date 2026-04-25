"""WikiAgent — Pydantic AI agent for diff-updating the memory/ markdown layer."""
from __future__ import annotations

import logging
import os

from pydantic import BaseModel
from pydantic_ai import Agent

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


class WikiUpdate(BaseModel):
    """Structured output from one wiki agent invocation."""
    path: str
    content: str
    rationale: str
    tokens_used: int = 0


def _resolve_model(config: WikiConfig) -> str:
    """Pick the model string based on available API keys.

    Priority:
    1. OPENROUTER_API_KEY → use openrouter_model
    2. ANTHROPIC_API_KEY → use anthropic:claude-haiku-4-5-20251001
    3. OPENAI_API_KEY → use config.model (default openai:gpt-4.1-mini)
    """
    if os.getenv("OPENROUTER_API_KEY"):
        return config.openrouter_model
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic:claude-haiku-4-5-20251001"
    # Fallback to explicit model (may fail if no key)
    return config.model


def build_wiki_agent(config: WikiConfig) -> Agent[WikiDeps, WikiUpdate]:
    """Construct the WikiAgent with all tools registered."""
    model_str = _resolve_model(config)
    log.info("wiki: using model %s", model_str)

    agent: Agent[WikiDeps, WikiUpdate] = Agent(
        model=model_str,
        deps_type=WikiDeps,
        output_type=WikiUpdate,
        system_prompt=SYSTEM_PROMPT,
        retries=2,
    )

    # Register tools
    agent.tool(tool_read_markdown, name="read_markdown")
    agent.tool(tool_write_markdown, name="write_markdown")
    agent.tool(tool_list_markdown_tree, name="list_markdown_tree")
    agent.tool(tool_query_graph, name="query_graph")
    agent.tool(tool_estimate_tokens, name="estimate_tokens")

    return agent
