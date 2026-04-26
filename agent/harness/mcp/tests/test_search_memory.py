"""Contract tests for ``search_memory``.

This tool is wired to ``kg_mcp`` for ``scope`` in {"kg", "all"} and
honestly stubs ``recent_chats``. Tests assert the *shape* of the response
— keys and types — so they pass whether kg_mcp is reachable, returns
results, or 404s. Graceful degradation is part of the contract.

The contract we lock in:

* return value is a dict
* ``results`` key exists and is a list (may be empty)
* ``query`` echoes the input
* ``scope`` is reflected back, defaulting to ``"all"`` when omitted
* if a ``stub`` flag is present it must be a bool (so callers can branch)

``search_memory`` is async (it may issue HTTP calls to kg_mcp), so tests
are async too. ``pyproject.toml`` has ``asyncio_mode = "auto"`` — no
decorator needed.
"""

from __future__ import annotations


class TestSearchMemoryShape:
    async def test_default_scope_is_all(self, server):
        out = await server.search_memory("anything")
        assert out["query"] == "anything"
        assert out["scope"] == "all"

    async def test_explicit_scope_is_reflected(self, server):
        for scope in ("kg", "recent_chats", "all"):
            out = await server.search_memory("q", scope=scope)
            assert out["scope"] == scope

    async def test_results_is_a_list(self, server):
        out = await server.search_memory("hello")
        assert "results" in out
        assert isinstance(out["results"], list)

    async def test_each_result_has_expected_keys_when_populated(self, server):
        # If kg_mcp is reachable and returns data, each result should
        # carry source/scope/snippet/score. If kg_mcp is unreachable
        # results will be []. We verify the shape only when populated,
        # so this test is reachability-tolerant.
        out = await server.search_memory("hello")
        for r in out["results"]:
            for key in ("source", "scope", "snippet", "score"):
                assert key in r, f"result missing {key}: {r}"

    async def test_empty_query_does_not_raise(self, server):
        out = await server.search_memory("")
        assert isinstance(out, dict)
        assert "results" in out

    async def test_stub_flag_is_bool_when_present(self, server):
        out = await server.search_memory("q")
        if "stub" in out:
            assert isinstance(out["stub"], bool)
