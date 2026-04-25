"""Pydantic AI tool implementations for the wiki agent.

All file-path operations are sandboxed to memory_root.
Graph access goes through MicrobotsDB named queries only.
"""
from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

import tiktoken
from pydantic import BaseModel
from pydantic_ai import RunContext

from wiki.deps import WikiDeps

log = logging.getLogger(__name__)

_ENCODER: tiktoken.Encoding | None = None


def _encoder() -> tiktoken.Encoding:
    global _ENCODER
    if _ENCODER is None:
        _ENCODER = tiktoken.get_encoding("cl100k_base")
    return _ENCODER


class WriteResult(BaseModel):
    path: str
    bytes_written: int
    tokens_estimated: int
    changed: bool


# ---------------------------------------------------------------------------
# Tool implementations (called via @agent.tool in agent.py)
# ---------------------------------------------------------------------------

async def tool_read_markdown(ctx: RunContext[WikiDeps], path: str) -> str:
    """Return existing markdown content, or empty string if the file doesn't exist."""
    try:
        full = ctx.deps.safe_path(path)
    except ValueError as e:
        return f"ERROR: {e}"
    if not full.exists():
        return ""
    return full.read_text(encoding="utf-8")


async def tool_write_markdown(
    ctx: RunContext[WikiDeps], path: str, content: str
) -> WriteResult:
    """Write content atomically. Returns WriteResult. Skips if content-hash unchanged."""
    try:
        full = ctx.deps.safe_path(path)
    except ValueError as e:
        return WriteResult(path=path, bytes_written=0, tokens_estimated=0, changed=False)

    if ctx.deps.config.write_dry_run:
        log.info("[dry_run] Would write %s (%d bytes)", path, len(content.encode()))
        toks = len(_encoder().encode(content))
        return WriteResult(path=path, bytes_written=0, tokens_estimated=toks, changed=True)

    new_hash = hashlib.sha256(content.encode()).hexdigest()
    if full.exists():
        existing = full.read_text(encoding="utf-8")
        if hashlib.sha256(existing.encode()).hexdigest() == new_hash:
            log.debug("write_markdown: unchanged, skipping %s", path)
            return WriteResult(
                path=path,
                bytes_written=len(content.encode()),
                tokens_estimated=len(_encoder().encode(content)),
                changed=False,
            )

    full.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write via temp file + rename
    fd, tmp = tempfile.mkstemp(dir=full.parent, prefix=".wiki_tmp_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, full)
    except Exception:
        os.unlink(tmp)
        raise

    toks = len(_encoder().encode(content))
    log.info("write_markdown: wrote %s (%d bytes, ~%d tokens)", path, len(content.encode()), toks)
    return WriteResult(
        path=path,
        bytes_written=len(content.encode()),
        tokens_estimated=toks,
        changed=True,
    )


async def tool_list_markdown_tree(ctx: RunContext[WikiDeps]) -> list[str]:
    """Return all .md paths under memory_root, relative."""
    root = ctx.deps.memory_root
    return sorted(
        str(p.relative_to(root))
        for p in root.rglob("*.md")
    )


async def tool_query_graph(
    ctx: RunContext[WikiDeps],
    query_name: str,
    params: dict[str, Any],
) -> list[dict[str, Any]]:
    """Run a whitelisted named graph query. query_name must be in the allowed set."""
    try:
        rows = await ctx.deps.db.named_query(query_name, params)
        return rows
    except ValueError as e:
        return [{"error": str(e)}]
    except Exception as e:
        log.error("tool_query_graph '%s' failed: %s", query_name, e)
        return [{"error": str(e)}]


async def tool_estimate_tokens(ctx: RunContext[WikiDeps], text: str) -> int:
    """Return tiktoken cl100k_base token count for text."""
    return len(_encoder().encode(text))
