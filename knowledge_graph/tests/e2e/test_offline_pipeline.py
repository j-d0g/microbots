"""Exercise the real fixture -> graph -> wiki path without any provider requests."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import pydantic_ai.models

from ingest.__main__ import _run
from ingest.db import unwrap_surreal_rows
from ingest.pullers import enabled_integrations
from wiki.orchestrator import run_wiki


async def _counts(db):
    result = {}
    for table in ("chat", "memory", "skill", "workflow", "chat_from", "chat_yields",
                  "skill_derived_from", "workflow_contains_skill"):
        rows = unwrap_surreal_rows(await db.query(f"SELECT count() AS n FROM {table} GROUP ALL"))
        result[table] = rows[0]["n"] if rows else 0
    return result


@pytest.mark.e2e
async def test_offline_fixture_pipeline_is_complete_and_idempotent(test_db, test_db_config, train_dir, monkeypatch):
    monkeypatch.setattr(pydantic_ai.models, "ALLOW_MODEL_REQUESTS", False)
    config = test_db_config
    config.offline = True
    config.openrouter_api_key = config.anthropic_api_key = config.composio_api_key = None
    names = enabled_integrations(config)
    expected = sum(len(json.loads((train_dir / f"{name}.json").read_text())) for name in names)

    result = await _run(names, config, from_fixtures=True)
    assert result == {"success": expected, "failed": 0, "skipped_dedup": 0, "dropped": 0}
    counts = await _counts(test_db)
    assert counts["chat"] == counts["chat_from"] == counts["chat_yields"] == expected
    assert 0 < counts["memory"] <= expected  # Identical insights share a memory record.
    assert counts["skill"] >= 2
    assert counts["workflow"] == 1
    assert counts["skill_derived_from"] >= counts["skill"]
    assert counts["workflow_contains_skill"] >= 2
    pages = await test_db.query("SELECT path, content, revision FROM wiki_page ORDER BY path")
    assert pages and all("[offline/demo]" in page["content"] for page in pages)

    # make ingest-demo applies schema before dedup; populated wiki must survive.
    for path in sorted((Path(__file__).parents[2] / "schema").glob("*.surql")):
        await test_db.query(path.read_text())
    assert await test_db.query("SELECT path, content, revision FROM wiki_page ORDER BY path") == pages
    rerun = await _run(names, config, from_fixtures=True)
    assert rerun == {"success": 0, "failed": 0, "skipped_dedup": expected, "dropped": 0}
    assert await _counts(test_db) == counts
    wiki = await run_wiki(config)
    assert wiki.failed == wiki.updated == 0
    assert wiki.unchanged == len(pages)
    assert await test_db.query("SELECT path, content, revision FROM wiki_page ORDER BY path") == pages


async def test_offline_mode_refuses_live_pullers(test_db_config):
    test_db_config.offline = True
    with pytest.raises(ValueError, match="requires --from-fixtures"):
        await _run(["slack"], test_db_config)


async def test_live_mode_requires_keys(test_db_config):
    test_db_config.offline = False
    test_db_config.openrouter_api_key = test_db_config.anthropic_api_key = None
    test_db_config.composio_api_key = None
    with pytest.raises(ValueError, match="COMPOSIO_API_KEY"):
        await _run(["slack"], test_db_config)
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        await _run(["slack"], test_db_config, from_fixtures=True)


async def test_wiki_failure_is_not_reported_as_success(test_db_config, monkeypatch):
    from wiki.orchestrator import WikiResult

    async def fail_wiki(config):
        return WikiResult(failed=1)

    monkeypatch.setattr(pydantic_ai.models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setattr("wiki.orchestrator.run_wiki", fail_wiki)
    test_db_config.offline = True
    result = await _run(["slack"], test_db_config, from_fixtures=True)
    assert result["success"] > 0
    assert result["failed"] == 1
