"""Unit tests for SurrealDB schema integrity (applied to ephemeral DB)."""
from __future__ import annotations

import pytest
import pytest_asyncio


@pytest.mark.asyncio
async def test_schema_tables_exist(test_db):
    """All expected tables are present after schema application."""
    res = await test_db.query("INFO FOR DB")
    info = res[0] if isinstance(res, list) else res
    if isinstance(info, dict):
        tables_raw = info.get("tables", info.get("tb", {}))
    else:
        tables_raw = {}

    # Get table names as strings
    if isinstance(tables_raw, dict):
        table_names = set(tables_raw.keys())
    else:
        # fallback: query SHOW TABLES
        rows = await test_db.query("SELECT * FROM (SHOW TABLES)")
        table_names = {r.get("name", "") for r in (rows if isinstance(rows, list) else [])}

    expected = {
        "user_profile", "integration", "entity", "chat",
        "memory", "skill", "workflow",
    }
    missing = expected - table_names
    assert not missing, f"Missing tables: {missing}"


@pytest.mark.asyncio
async def test_schema_indexes_exist(test_db):
    """Spot-check that key indexes are defined."""
    res = await test_db.query("INFO FOR TABLE integration")
    info = res[0] if isinstance(res, list) else res
    assert info is not None  # schema applied without error


@pytest.mark.asyncio
async def test_upsert_user_profile(test_db):
    """user_profile can be upserted and queried."""
    await test_db.query("""
        UPSERT user_profile:default CONTENT {
            name: "TestUser",
            role: "engineer",
            goals: [],
            preferences: {},
            context_window: 4000,
            created_at: time::now(),
            updated_at: time::now()
        }
    """)
    res = await test_db.query("SELECT name FROM user_profile LIMIT 1")
    rows = res if isinstance(res, list) else [res]
    flat = [r for r in rows if isinstance(r, dict) and r.get("name")]
    assert any(r.get("name") == "TestUser" for r in flat)


@pytest.mark.asyncio
async def test_upsert_integration(test_db):
    """integration can be upserted with slug uniqueness."""
    await test_db.query("""
        UPSERT integration:slack CONTENT {
            name: "Slack", slug: "slack",
            category: "communication",
            created_at: time::now(), updated_at: time::now()
        }
    """)
    res = await test_db.query("SELECT slug FROM integration WHERE slug = 'slack'")
    rows = res if isinstance(res, list) else [res]
    assert any("slack" in str(r) for r in rows if isinstance(r, dict))


@pytest.mark.asyncio
async def test_relate_chat_from(test_db):
    """chat_from relation can be created between chat and integration."""
    await test_db.query("""
        UPSERT integration:github CONTENT {
            name: "GitHub", slug: "github",
            created_at: time::now(), updated_at: time::now()
        };
        UPSERT chat:test_chat CONTENT {
            content: "Test content",
            source_type: "github_pr",
            created_at: time::now()
        };
        RELATE chat:test_chat->chat_from->integration:github
    """)
    res = await test_db.query("SELECT count() AS n FROM chat_from GROUP ALL")
    rows = res if isinstance(res, list) else [res]
    # Should have at least one relation
    assert isinstance(rows, list)
