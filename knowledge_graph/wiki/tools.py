"""Pydantic AI tool implementations for the wiki agent.

The wiki layer lives in SurrealDB (`wiki_page` / `wiki_page_revision` tables);
the tools below are thin wrappers around `MicrobotsDB`.
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel
from pydantic_ai import RunContext

from db.wiki import estimate_tokens as _estimate_tokens_fn
from wiki.deps import WikiDeps

log = logging.getLogger(__name__)


class WriteResult(BaseModel):
    path: str
    revision: int
    bytes_written: int
    token_estimate: int
    unchanged: bool


# ---------------------------------------------------------------------------
# Tools (registered on the Pydantic AI agent in agent.py)
# ---------------------------------------------------------------------------

async def tool_read_markdown(ctx: RunContext[WikiDeps], path: str) -> str:
    """Return the current content of a wiki page (empty string if blank)."""
    page = await ctx.deps.db.get_wiki_page(path)
    if page is None:
        return f"ERROR: no wiki_page exists for path={path!r}"
    return page.content


async def tool_write_markdown(
    ctx: RunContext[WikiDeps],
    path: str,
    content: str,
    rationale: str | None = None,
) -> WriteResult:
    """Write content to the wiki page at `path`. Idempotent on hash match."""
    if ctx.deps.config.write_dry_run:
        toks = _estimate_tokens_fn(content)
        log.info("[dry_run] Would write %s (%d bytes, ~%d tokens)", path, len(content.encode()), toks)
        return WriteResult(
            path=path,
            revision=0,
            bytes_written=len(content.encode()),
            token_estimate=toks,
            unchanged=False,
        )

    try:
        result = await ctx.deps.db.write_wiki_page(
            path=path,
            content=content,
            written_by="wiki_agent",
            rationale=rationale,
        )
    except ValueError as e:
        log.warning("write_markdown rejected: %s", e)
        return WriteResult(
            path=path,
            revision=0,
            bytes_written=0,
            token_estimate=0,
            unchanged=True,
        )
    log.info(
        "write_markdown: wrote %s (rev=%d, bytes=%d, tokens=%d, unchanged=%s)",
        path, result.revision, result.bytes_written, result.token_estimate, result.unchanged,
    )
    return WriteResult(
        path=result.path,
        revision=result.revision,
        bytes_written=result.bytes_written,
        token_estimate=result.token_estimate,
        unchanged=result.unchanged,
    )


async def tool_list_markdown_tree(ctx: RunContext[WikiDeps]) -> list[str]:
    """Return all wiki paths in depth/path order."""
    nodes = await ctx.deps.db.list_wiki_tree()
    return [n.path for n in nodes]


async def tool_query_graph(
    ctx: RunContext[WikiDeps],
    query_name: str,
    params: dict[str, Any],
) -> list[dict[str, Any]]:
    """Run a whitelisted named graph query."""
    try:
        return await ctx.deps.db.named_query(query_name, params)
    except ValueError as e:
        return [{"error": str(e)}]
    except Exception as e:
        log.error("tool_query_graph '%s' failed: %s", query_name, e)
        return [{"error": str(e)}]


async def tool_estimate_tokens(ctx: RunContext[WikiDeps], text: str) -> int:
    """Return tiktoken cl100k_base token count for `text`."""
    return _estimate_tokens_fn(text)
