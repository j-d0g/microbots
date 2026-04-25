"""Unit tests for wiki tool implementations (no LLM required)."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from config import WikiConfig
from wiki.budgets import budget_for
from wiki.deps import WikiDeps
from wiki.tools import (
    tool_estimate_tokens,
    tool_list_markdown_tree,
    tool_read_markdown,
    tool_write_markdown,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ctx(memory_root: Path, dry_run: bool = False) -> MagicMock:
    mock_db = MagicMock()
    mock_db.named_query = AsyncMock(return_value=[])
    cfg = WikiConfig(write_dry_run=dry_run)
    deps = WikiDeps(db=mock_db, memory_root=memory_root, config=cfg)
    ctx = MagicMock()
    ctx.deps = deps
    return ctx


# ---------------------------------------------------------------------------
# Budget tests
# ---------------------------------------------------------------------------

def test_budget_user_md(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    p = root / "user.md"
    assert budget_for(p, root) == 4000


def test_budget_layer_agents_md(tmp_path):
    root = tmp_path / "memory"
    (root / "integrations").mkdir(parents=True)
    p = root / "integrations" / "agents.md"
    assert budget_for(p, root) == 600


def test_budget_sublayer_agents_md(tmp_path):
    root = tmp_path / "memory"
    (root / "integrations" / "slack").mkdir(parents=True)
    p = root / "integrations" / "slack" / "agents.md"
    assert budget_for(p, root) == 300


# ---------------------------------------------------------------------------
# Path sandboxing
# ---------------------------------------------------------------------------

def test_safe_path_ok(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    deps = WikiDeps(db=MagicMock(), memory_root=root, config=WikiConfig())
    p = deps.safe_path("user.md")
    assert p == root / "user.md"


def test_safe_path_escape_blocked(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    deps = WikiDeps(db=MagicMock(), memory_root=root, config=WikiConfig())
    with pytest.raises(ValueError, match="escapes memory_root"):
        deps.safe_path("../../etc/passwd")


# ---------------------------------------------------------------------------
# tool_read_markdown
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_read_markdown_missing_file(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    ctx = _make_ctx(root)
    result = await tool_read_markdown(ctx, "user.md")
    assert result == ""


@pytest.mark.asyncio
async def test_read_markdown_existing_file(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    (root / "user.md").write_text("# User\nHello world", encoding="utf-8")
    ctx = _make_ctx(root)
    result = await tool_read_markdown(ctx, "user.md")
    assert "Hello world" in result


# ---------------------------------------------------------------------------
# tool_write_markdown
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_write_markdown_dry_run(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    ctx = _make_ctx(root, dry_run=True)
    result = await tool_write_markdown(ctx, "user.md", "# New content")
    assert result.changed is True
    assert not (root / "user.md").exists()


@pytest.mark.asyncio
async def test_write_markdown_creates_file(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    ctx = _make_ctx(root, dry_run=False)
    result = await tool_write_markdown(ctx, "user.md", "# New content")
    assert result.changed is True
    assert (root / "user.md").read_text() == "# New content"


@pytest.mark.asyncio
async def test_write_markdown_idempotent(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    ctx = _make_ctx(root, dry_run=False)
    content = "# Same content"
    await tool_write_markdown(ctx, "user.md", content)
    result2 = await tool_write_markdown(ctx, "user.md", content)
    assert result2.changed is False


@pytest.mark.asyncio
async def test_write_markdown_path_escape_blocked(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    ctx = _make_ctx(root, dry_run=False)
    result = await tool_write_markdown(ctx, "../../evil.md", "evil")
    assert result.changed is False
    assert not (tmp_path / "evil.md").exists()


# ---------------------------------------------------------------------------
# tool_list_markdown_tree
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_markdown_tree(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    (root / "user.md").write_text("x")
    (root / "integrations").mkdir()
    (root / "integrations" / "agents.md").write_text("y")
    ctx = _make_ctx(root)
    result = await tool_list_markdown_tree(ctx)
    assert "user.md" in result
    assert "integrations/agents.md" in result


# ---------------------------------------------------------------------------
# tool_estimate_tokens
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_estimate_tokens_non_zero(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    ctx = _make_ctx(root)
    count = await tool_estimate_tokens(ctx, "Hello world, this is a test sentence.")
    assert count > 0


@pytest.mark.asyncio
async def test_estimate_tokens_empty(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    ctx = _make_ctx(root)
    count = await tool_estimate_tokens(ctx, "")
    assert count == 0
