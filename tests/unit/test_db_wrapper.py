"""Unit tests for the MicrobotsDB named-query wrapper.

Runs against the ephemeral SurrealDB fixture (must have DB running).
Each test seeds minimal data, runs a named query, and validates schema.
"""
from __future__ import annotations

import pytest
import pytest_asyncio

from db.client import MicrobotsDB
from db.queries import NAMED_QUERIES


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

async def _seed_integration(db, slug: str = "slack", name: str = "Slack") -> None:
    await db.query(
        f"""
        UPSERT integration:{slug} CONTENT {{
            name: "{name}", slug: "{slug}", category: "communication",
            description: "Test integration",
            user_purpose: "Testing",
            usage_patterns: [],
            navigation_tips: [],
            frequency: "daily",
            created_at: time::now(), updated_at: time::now()
        }}
        """
    )


async def _seed_user_profile(db) -> None:
    await db.query("""
        UPSERT user_profile:default CONTENT {
            name: "TestUser", role: "AI engineer",
            goals: [], preferences: {},
            context_window: 4000,
            created_at: time::now(), updated_at: time::now()
        }
    """)


async def _seed_entity(db, slug: str = "alice", name: str = "Alice", etype: str = "person") -> None:
    await db.query(
        f"""
        UPSERT entity:{slug} CONTENT {{
            name: "{name}", entity_type: "{etype}",
            description: "Test entity", aliases: [],
            tags: [], created_at: time::now(), updated_at: time::now()
        }}
        """
    )


async def _seed_memory(db, slug: str = "mem1", content: str = "Test memory") -> None:
    await db.query(
        f"""
        UPSERT memory:{slug} CONTENT {{
            content: "{content}", memory_type: "fact",
            confidence: 0.8, tags: [],
            created_at: time::now(), updated_at: time::now()
        }}
        """
    )


async def _seed_skill(db, slug: str = "skill1", strength: int = 3) -> None:
    await db.query(
        f"""
        UPSERT skill:{slug} CONTENT {{
            name: "Test Skill", slug: "{slug}",
            description: "A test skill",
            steps: [], tags: ["strength:{strength}"],
            frequency: "daily",
            created_at: time::now(), updated_at: time::now()
        }}
        """
    )


async def _seed_workflow(db, slug: str = "wf1") -> None:
    await db.query(
        f"""
        UPSERT workflow:{slug} CONTENT {{
            name: "Test Workflow", slug: "{slug}",
            description: "A test workflow",
            tags: [],
            created_at: time::now(), updated_at: time::now()
        }}
        """
    )


# ---------------------------------------------------------------------------
# Tests: param validation
# ---------------------------------------------------------------------------

def test_unknown_query_rejected(microbots_db):
    """Passing an unregistered query name must raise ValueError immediately."""
    import asyncio
    with pytest.raises(ValueError, match="Unknown named query"):
        asyncio.get_event_loop().run_until_complete(
            microbots_db.named_query("DROP TABLE user_profile")
        )


def test_raw_surql_cannot_be_injected(microbots_db):
    """Arbitrary SurrealQL strings as query names must be rejected."""
    import asyncio
    with pytest.raises(ValueError, match="Unknown named query"):
        asyncio.get_event_loop().run_until_complete(
            microbots_db.named_query("SELECT * FROM user_profile")
        )


def test_integration_detail_requires_slug(microbots_db):
    """integration_detail must raise ValueError if 'slug' param is missing."""
    import asyncio
    with pytest.raises(ValueError, match="requires param 'slug'"):
        asyncio.get_event_loop().run_until_complete(
            microbots_db.named_query("integration_detail", {})
        )


# ---------------------------------------------------------------------------
# Tests: named queries return valid rows
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_integrations_overview_empty(microbots_db):
    rows = await microbots_db.named_query("integrations_overview")
    assert isinstance(rows, list)


@pytest.mark.asyncio
async def test_integrations_overview_with_data(test_db, microbots_db):
    await _seed_integration(test_db, "github", "GitHub")
    rows = await microbots_db.named_query("integrations_overview")
    assert any(r.get("slug") == "github" for r in rows)


@pytest.mark.asyncio
async def test_user_profile_query(test_db, microbots_db):
    await _seed_user_profile(test_db)
    rows = await microbots_db.named_query("user_profile")
    # May return a single dict with nested keys
    assert isinstance(rows, (list, dict))


@pytest.mark.asyncio
async def test_memories_top_returns_list(test_db, microbots_db):
    await _seed_memory(test_db)
    rows = await microbots_db.named_query("memories_top", {"limit": 5, "by": "confidence"})
    assert isinstance(rows, list)


@pytest.mark.asyncio
async def test_skills_all_filter(test_db, microbots_db):
    await _seed_skill(test_db, "deploy_skill", strength=4)
    rows = await microbots_db.named_query("skills_all", {"min_strength": 3})
    assert isinstance(rows, list)


@pytest.mark.asyncio
async def test_entity_types_aggregation(test_db, microbots_db):
    await _seed_entity(test_db, "alice", "Alice", "person")
    await _seed_entity(test_db, "microbots_repo", "microbots", "repo")
    rows = await microbots_db.named_query("entity_types")
    assert isinstance(rows, list)
    types = {r.get("entity_type") for r in rows}
    assert "person" in types
    assert "repo" in types


@pytest.mark.asyncio
async def test_entities_by_type(test_db, microbots_db):
    await _seed_entity(test_db, "bob", "Bob", "person")
    rows = await microbots_db.named_query("entities_by_type", {"entity_type": "person"})
    assert isinstance(rows, list)
    names = [r.get("name") for r in rows]
    assert "Bob" in names


@pytest.mark.asyncio
async def test_chats_summary_empty(microbots_db):
    rows = await microbots_db.named_query("chats_summary")
    assert isinstance(rows, list)


@pytest.mark.asyncio
async def test_workflows_all_empty(microbots_db):
    rows = await microbots_db.named_query("workflows_all")
    assert isinstance(rows, list)


# ---------------------------------------------------------------------------
# Schema snapshot test
# ---------------------------------------------------------------------------

def test_named_queries_have_descriptions():
    """Every named query must have a non-empty description string."""
    for name, qdef in NAMED_QUERIES.items():
        assert qdef.description, f"Query '{name}' has no description"


def test_all_registered_query_names():
    """Spot-check that all 10 expected queries are registered."""
    expected = {
        "integrations_overview", "integration_detail", "entities_by_type",
        "entity_detail", "memories_top", "skills_all", "workflows_all",
        "chats_summary", "user_profile", "entity_types",
    }
    assert expected <= set(NAMED_QUERIES.keys())
