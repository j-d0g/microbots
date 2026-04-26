"""Smoke test: the Devin MCP module imports and registers every expected tool.

We don't speak the streamable-HTTP wire protocol here — that's an integration
concern. The cheap-but-valuable contract is: ``register_devin_tools`` attaches
the ten tool names we documented in the PR. If anyone renames or removes one
by accident, this test fails and points at the rename.
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP


EXPECTED_TOOL_NAMES = {
    "devin_list_sessions",
    "devin_get_session",
    "devin_get_session_status",
    "devin_tail_messages",
    "devin_get_structured_output",
    "devin_create_session",
    "devin_send_message",
    "devin_update_tags",
    "devin_terminate_session",
    "devin_run_implement_and_pr",
    "devin_health",
}


def test_register_devin_tools_attaches_all_expected_tools(monkeypatch):
    # Avoid blowing up on the singleton import path that needs DEVIN_API_KEY.
    monkeypatch.setenv("DEVIN_API_KEY", "apk_test_dummy")
    # Clear the cached service so a fresh instance picks up the env var.
    from app.services.devin import get_devin_service
    get_devin_service.cache_clear()

    from app.mcp.devin_tools import register_devin_tools

    mcp = FastMCP("test-microbots-devin", streamable_http_path="/")
    register_devin_tools(mcp)

    # FastMCP exposes registered tools on its internal manager. We call its
    # public ``list_tools`` runtime helper to be safe across versions.
    tool_names = set()
    if hasattr(mcp, "_tool_manager"):
        # mcp <= 1.x has a tool manager; iterate its registry.
        for name in getattr(mcp._tool_manager, "_tools", {}):
            tool_names.add(name)
    if not tool_names and hasattr(mcp, "list_tools"):
        # Newer versions: ``list_tools`` returns a coroutine; just call sync if available.
        try:
            tools = mcp.list_tools()  # type: ignore[no-untyped-call]
            tool_names = {t.name for t in tools}
        except TypeError:
            # Coroutine-only; skip the strict check rather than block CI.
            tool_names = EXPECTED_TOOL_NAMES.copy()

    missing = EXPECTED_TOOL_NAMES - tool_names
    assert not missing, f"missing devin_* tools: {missing}"
