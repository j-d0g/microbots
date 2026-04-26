"""E2E tests for the KG write (and write→read round-trip) REST endpoints.

These tests hit a REAL SurrealDB instance (ws://localhost:8000/rpc).
All test data is prefixed with ``test_e2e_`` to avoid collisions.

Run:
    uv run pytest app/tests/test_kg_api_e2e.py -v --tb=short
"""

from __future__ import annotations

import os
import time
import uuid

import httpx
import pytest

# Ensure SurrealDB env vars are set for the local dev instance.
os.environ.setdefault("SURREAL_URL", "ws://localhost:8000/rpc")
os.environ.setdefault("SURREAL_USER", "root")
os.environ.setdefault("SURREAL_PASS", "root")
os.environ.setdefault("SURREAL_NS", "microbots")
os.environ.setdefault("SURREAL_DB", "memory")

from app.main import app  # noqa: E402 — env must be set first

pytestmark = pytest.mark.e2e

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UID = uuid.uuid4().hex[:8]  # unique per test-run to avoid collisions


def _uid(label: str) -> str:
    return f"test_e2e_{label}_{_UID}"


# ---------------------------------------------------------------------------
# Fixture: async httpx client wired to the FastAPI app
# ---------------------------------------------------------------------------


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------------------
# Cleanup: remove test data after the entire module finishes
# ---------------------------------------------------------------------------


async def _do_cleanup() -> None:
    """Delete records whose ids contain the run-specific UID."""
    try:
        from app.services.surreal import session

        async with session() as db:
            for table in [
                "memory", "entity", "skill", "workflow", "chat",
                "wiki_page", "wiki_page_revision",
            ]:
                await db.query(
                    f"DELETE {table} WHERE string::contains(string::lowercase(id), $uid)",
                    {"uid": _UID},
                )
            for edge_table in [
                "chat_yields", "memory_about", "appears_in",
                "skill_uses", "workflow_contains_skill",
                "chat_from", "chat_mentions",
            ]:
                try:
                    await db.query(
                        f"DELETE {edge_table} WHERE string::contains(string::lowercase(id), $uid)",
                        {"uid": _UID},
                    )
                except Exception:
                    pass
    except Exception:
        pass


@pytest.fixture(autouse=True, scope="session")
def cleanup_test_data_sync():
    """Schedule best-effort cleanup after the entire session."""
    yield
    import asyncio
    try:
        asyncio.run(_do_cleanup())
    except Exception:
        pass


# ===================================================================
# POST /api/kg/memories
# ===================================================================


class TestPostMemory:
    async def test_valid_memory_returns_201(self, client: httpx.AsyncClient):
        body = {"content": _uid("memory_valid"), "memory_type": "fact", "confidence": 0.9}
        r = await client.post("/api/kg/memories", json=body)
        assert r.status_code == 201
        data = r.json()
        assert "id" in data
        assert "memory_id" in data

    async def test_missing_content_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/memories", json={"memory_type": "fact"})
        assert r.status_code == 422

    async def test_empty_content_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/memories", json={"content": ""})
        assert r.status_code == 422

    async def test_whitespace_only_content_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/memories", json={"content": "   "})
        assert r.status_code == 422

    async def test_invalid_confidence_type_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/memories",
            json={"content": _uid("bad_conf"), "confidence": "not_a_number"},
        )
        assert r.status_code == 422

    async def test_confidence_out_of_range_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/memories",
            json={"content": _uid("bad_conf2"), "confidence": 5.0},
        )
        assert r.status_code == 422

    async def test_extra_fields_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/memories",
            json={"content": _uid("extra"), "bogus_field": "nope"},
        )
        assert r.status_code == 422

    async def test_idempotent_same_content(self, client: httpx.AsyncClient):
        body = {"content": _uid("idem_mem"), "confidence": 0.8}
        r1 = await client.post("/api/kg/memories", json=body)
        r2 = await client.post("/api/kg/memories", json=body)
        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r1.json()["memory_id"] == r2.json()["memory_id"]

    async def test_long_content_succeeds(self, client: httpx.AsyncClient):
        long_text = _uid("long_mem") + " " + "x" * 1200
        r = await client.post("/api/kg/memories", json={"content": long_text})
        assert r.status_code == 201

    async def test_with_optional_fields(self, client: httpx.AsyncClient):
        body = {
            "content": _uid("full_mem"),
            "memory_type": "observation",
            "confidence": 0.5,
            "source": "test_suite",
            "tags": ["test", "e2e"],
        }
        r = await client.post("/api/kg/memories", json=body)
        assert r.status_code == 201


# ===================================================================
# POST /api/kg/entities
# ===================================================================


class TestPostEntity:
    async def test_valid_entity_returns_201(self, client: httpx.AsyncClient):
        body = {"name": _uid("ent"), "entity_type": "person"}
        r = await client.post("/api/kg/entities", json=body)
        assert r.status_code == 201
        data = r.json()
        assert "id" in data
        assert "slug" in data

    async def test_missing_name_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/entities", json={"entity_type": "person"})
        assert r.status_code == 422

    async def test_missing_entity_type_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/entities", json={"name": _uid("noetype")})
        assert r.status_code == 422

    async def test_empty_name_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/entities", json={"name": "", "entity_type": "person"})
        assert r.status_code == 422

    async def test_empty_entity_type_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/entities", json={"name": _uid("e"), "entity_type": ""})
        assert r.status_code == 422

    async def test_idempotent_same_entity(self, client: httpx.AsyncClient):
        body = {"name": _uid("idem_ent"), "entity_type": "tool"}
        r1 = await client.post("/api/kg/entities", json=body)
        r2 = await client.post("/api/kg/entities", json=body)
        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r1.json()["slug"] == r2.json()["slug"]

    async def test_with_aliases_and_tags(self, client: httpx.AsyncClient):
        body = {
            "name": _uid("ent_full"),
            "entity_type": "service",
            "description": "A test entity",
            "aliases": ["alias1"],
            "tags": ["backend"],
        }
        r = await client.post("/api/kg/entities", json=body)
        assert r.status_code == 201


# ===================================================================
# POST /api/kg/skills
# ===================================================================


class TestPostSkill:
    async def test_valid_skill_returns_201(self, client: httpx.AsyncClient):
        body = {
            "slug": _uid("skill"),
            "name": "Test Skill",
            "description": "A test skill for E2E",
        }
        r = await client.post("/api/kg/skills", json=body)
        assert r.status_code == 201
        data = r.json()
        assert "id" in data
        assert "slug" in data
        assert data["created"] is True
        assert data["strength"] == 1

    async def test_missing_slug_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/skills", json={"name": "x", "description": "x"}
        )
        assert r.status_code == 422

    async def test_missing_name_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/skills", json={"slug": _uid("s"), "description": "x"}
        )
        assert r.status_code == 422

    async def test_missing_description_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/skills", json={"slug": _uid("s"), "name": "x"}
        )
        assert r.status_code == 422

    async def test_empty_slug_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/skills", json={"slug": "", "name": "x", "description": "x"}
        )
        assert r.status_code == 422

    async def test_strength_increment_adds(self, client: httpx.AsyncClient):
        slug = _uid("str_inc")
        body = {"slug": slug, "name": "Inc Skill", "description": "test inc"}
        r1 = await client.post("/api/kg/skills", json=body)
        assert r1.json()["strength"] == 1
        assert r1.json()["created"] is True

        r2 = await client.post("/api/kg/skills", json={**body, "strength_increment": 3})
        assert r2.json()["strength"] == 4
        assert r2.json()["created"] is False

    async def test_invalid_strength_increment_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/skills",
            json={
                "slug": _uid("bad_si"),
                "name": "x",
                "description": "x",
                "strength_increment": 0,
            },
        )
        assert r.status_code == 422

    async def test_with_optional_fields(self, client: httpx.AsyncClient):
        body = {
            "slug": _uid("sk_full"),
            "name": "Full Skill",
            "description": "Has all fields",
            "steps": ["step1", "step2"],
            "frequency": "daily",
            "tags": ["automation"],
            "uses_integrations": [],
        }
        r = await client.post("/api/kg/skills", json=body)
        assert r.status_code == 201


# ===================================================================
# POST /api/kg/workflows
# ===================================================================


class TestPostWorkflow:
    async def test_valid_workflow_returns_201(self, client: httpx.AsyncClient):
        body = {
            "slug": _uid("wf"),
            "name": "Test Workflow",
            "description": "An E2E workflow",
        }
        r = await client.post("/api/kg/workflows", json=body)
        assert r.status_code == 201
        data = r.json()
        assert "id" in data
        assert "slug" in data

    async def test_missing_required_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/workflows", json={"slug": _uid("wf2")})
        assert r.status_code == 422

    async def test_empty_slug_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/workflows",
            json={"slug": "", "name": "x", "description": "x"},
        )
        assert r.status_code == 422

    async def test_idempotent_same_workflow(self, client: httpx.AsyncClient):
        body = {
            "slug": _uid("idem_wf"),
            "name": "Idem WF",
            "description": "test idempotency",
        }
        r1 = await client.post("/api/kg/workflows", json=body)
        r2 = await client.post("/api/kg/workflows", json=body)
        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r1.json()["slug"] == r2.json()["slug"]

    async def test_with_skill_chain(self, client: httpx.AsyncClient):
        # First create skills that the workflow references
        sk1 = _uid("chain_sk1")
        sk2 = _uid("chain_sk2")
        await client.post(
            "/api/kg/skills",
            json={"slug": sk1, "name": "Chain1", "description": "first"},
        )
        await client.post(
            "/api/kg/skills",
            json={"slug": sk2, "name": "Chain2", "description": "second"},
        )

        body = {
            "slug": _uid("wf_chain"),
            "name": "Chain WF",
            "description": "has a skill chain",
            "skill_chain": [
                {"slug": sk1, "step_order": 0},
                {"slug": sk2, "step_order": 1},
            ],
        }
        r = await client.post("/api/kg/workflows", json=body)
        assert r.status_code == 201

    async def test_with_all_optional_fields(self, client: httpx.AsyncClient):
        body = {
            "slug": _uid("wf_full"),
            "name": "Full WF",
            "description": "complete workflow",
            "trigger": "on_push",
            "outcome": "deployed",
            "frequency": "weekly",
            "tags": ["ci", "cd"],
        }
        r = await client.post("/api/kg/workflows", json=body)
        assert r.status_code == 201


# ===================================================================
# POST /api/kg/chats
# ===================================================================


class TestPostChat:
    async def test_valid_chat_returns_201(self, client: httpx.AsyncClient):
        body = {
            "content": _uid("chat_valid"),
            "source_type": "slack",
            "signal_level": "mid",
        }
        r = await client.post("/api/kg/chats", json=body)
        assert r.status_code == 201
        data = r.json()
        assert "id" in data

    async def test_missing_content_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/chats", json={"source_type": "slack"})
        assert r.status_code == 422

    async def test_missing_source_type_returns_422(self, client: httpx.AsyncClient):
        r = await client.post("/api/kg/chats", json={"content": _uid("no_src")})
        assert r.status_code == 422

    async def test_empty_content_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/chats", json={"content": "", "source_type": "slack"}
        )
        assert r.status_code == 422

    async def test_invalid_signal_level_returns_422(self, client: httpx.AsyncClient):
        r = await client.post(
            "/api/kg/chats",
            json={
                "content": _uid("bad_sig"),
                "source_type": "slack",
                "signal_level": "extreme",
            },
        )
        assert r.status_code == 422

    async def test_idempotent_via_source_id(self, client: httpx.AsyncClient):
        sid = _uid("idem_chat")
        body = {"content": _uid("chat_idem"), "source_type": "slack", "source_id": sid}
        r1 = await client.post("/api/kg/chats", json=body)
        r2 = await client.post("/api/kg/chats", json=body)
        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r1.json()["id"] == r2.json()["id"]

    async def test_with_mentions(self, client: httpx.AsyncClient):
        # Create an entity to mention
        ent_name = _uid("mention_ent")
        await client.post(
            "/api/kg/entities",
            json={"name": ent_name, "entity_type": "person"},
        )
        body = {
            "content": _uid("chat_mention"),
            "source_type": "slack",
            "mentions": [
                {"id": f"entity:person_{ent_name.lower()}", "mention_type": "author"}
            ],
        }
        r = await client.post("/api/kg/chats", json=body)
        assert r.status_code == 201

    async def test_long_content_succeeds(self, client: httpx.AsyncClient):
        long = _uid("long_chat") + " " + "y" * 1500
        r = await client.post(
            "/api/kg/chats", json={"content": long, "source_type": "test"}
        )
        assert r.status_code == 201


# ===================================================================
# PUT /api/kg/wiki/{path}
# ===================================================================


class TestPutWikiPage:
    async def test_create_wiki_page(self, client: httpx.AsyncClient):
        path = _uid("wiki_page")
        r = await client.put(
            f"/api/kg/wiki/{path}",
            json={"content": "Hello wiki", "rationale": "initial"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["path"] == path
        assert data["updated"] is True
        assert data["revision"] == 1

    async def test_update_wiki_page_increments_revision(self, client: httpx.AsyncClient):
        path = _uid("wiki_rev")
        await client.put(f"/api/kg/wiki/{path}", json={"content": "v1"})
        r2 = await client.put(f"/api/kg/wiki/{path}", json={"content": "v2"})
        data = r2.json()
        assert data["updated"] is True
        assert data["revision"] == 2

    async def test_same_content_no_update(self, client: httpx.AsyncClient):
        path = _uid("wiki_same")
        await client.put(f"/api/kg/wiki/{path}", json={"content": "unchanged"})
        r2 = await client.put(f"/api/kg/wiki/{path}", json={"content": "unchanged"})
        data = r2.json()
        assert data["unchanged"] is True
        assert data["updated"] is False

    async def test_special_chars_in_path(self, client: httpx.AsyncClient):
        path = _uid("wiki-special_chars.2026")
        r = await client.put(
            f"/api/kg/wiki/{path}", json={"content": "special path content"}
        )
        assert r.status_code == 200

    async def test_nested_path(self, client: httpx.AsyncClient):
        path = f"integrations/{_uid('nested_wiki')}"
        r = await client.put(
            f"/api/kg/wiki/{path}", json={"content": "nested page"}
        )
        assert r.status_code == 200
        assert r.json()["path"] == path


# ===================================================================
# PATCH /api/kg/user
# ===================================================================


class TestPatchUser:
    async def test_update_name(self, client: httpx.AsyncClient):
        r = await client.patch("/api/kg/user", json={"name": _uid("user")})
        assert r.status_code == 200
        data = r.json()
        assert data["updated"] is True

    async def test_update_multiple_fields(self, client: httpx.AsyncClient):
        r = await client.patch(
            "/api/kg/user",
            json={
                "name": _uid("user2"),
                "role": "tester",
                "goals": ["pass tests"],
                "context_window": 8192,
            },
        )
        assert r.status_code == 200
        assert r.json()["updated"] is True

    async def test_update_preferences(self, client: httpx.AsyncClient):
        r = await client.patch(
            "/api/kg/user",
            json={"preferences": {"theme": "dark", "lang": "en"}},
        )
        assert r.status_code == 200

    async def test_empty_body_no_update(self, client: httpx.AsyncClient):
        r = await client.patch("/api/kg/user", json={})
        assert r.status_code == 200
        assert r.json()["updated"] is False

    async def test_invalid_context_window_returns_422(self, client: httpx.AsyncClient):
        r = await client.patch("/api/kg/user", json={"context_window": 10})
        assert r.status_code == 422

    async def test_extra_fields_returns_422(self, client: httpx.AsyncClient):
        r = await client.patch("/api/kg/user", json={"bogus": "field"})
        assert r.status_code == 422


# ===================================================================
# Write → Read round-trip tests
# ===================================================================


class TestRoundTripMemory:
    async def test_post_then_get_memories(self, client: httpx.AsyncClient):
        content = _uid("rt_mem")
        await client.post(
            "/api/kg/memories",
            json={"content": content, "confidence": 0.95},
        )
        r = await client.get("/api/kg/memories", params={"by": "confidence", "limit": 200})
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        # The response is a list of lists (SurrealDB query result wrapper)
        # Flatten if needed
        flat = items
        if flat and isinstance(flat[0], list):
            flat = [item for sublist in flat for item in sublist]
        found = any(
            content in str(item.get("content", ""))
            for item in flat
            if isinstance(item, dict)
        )
        assert found, f"Memory with content containing '{content}' not found in GET /memories"


class TestRoundTripEntity:
    async def test_post_then_get_entities(self, client: httpx.AsyncClient):
        name = _uid("rt_ent")
        etype = "tool"
        await client.post(
            "/api/kg/entities",
            json={"name": name, "entity_type": etype},
        )
        r = await client.get("/api/kg/entities", params={"entity_type": etype})
        assert r.status_code == 200
        items = r.json()
        flat = items
        if flat and isinstance(flat[0], list):
            flat = [item for sublist in flat for item in sublist]
        found = any(
            name in str(item.get("name", ""))
            for item in flat
            if isinstance(item, dict)
        )
        assert found, f"Entity '{name}' not found in GET /entities?entity_type={etype}"


class TestRoundTripSkill:
    async def test_post_then_get_skills(self, client: httpx.AsyncClient):
        slug = _uid("rt_skill")
        await client.post(
            "/api/kg/skills",
            json={"slug": slug, "name": "RT Skill", "description": "round trip"},
        )
        r = await client.get("/api/kg/skills", params={"min_strength": 1})
        assert r.status_code == 200
        items = r.json()
        flat = items
        if flat and isinstance(flat[0], list):
            flat = [item for sublist in flat for item in sublist]
        found = any(
            slug in str(item.get("slug", "")) or slug in str(item.get("name", ""))
            for item in flat
            if isinstance(item, dict)
        )
        assert found, f"Skill '{slug}' not found in GET /skills"


class TestRoundTripWorkflow:
    async def test_post_then_get_workflows(self, client: httpx.AsyncClient):
        slug = _uid("rt_wf")
        await client.post(
            "/api/kg/workflows",
            json={"slug": slug, "name": "RT WF", "description": "round trip wf"},
        )
        r = await client.get("/api/kg/workflows")
        assert r.status_code == 200
        items = r.json()
        flat = items
        if flat and isinstance(flat[0], list):
            flat = [item for sublist in flat for item in sublist]
        found = any(
            slug in str(item.get("slug", "")) or slug in str(item.get("name", ""))
            for item in flat
            if isinstance(item, dict)
        )
        assert found, f"Workflow '{slug}' not found in GET /workflows"


class TestRoundTripUser:
    async def test_patch_then_get_user(self, client: httpx.AsyncClient):
        unique_name = _uid("rt_user")
        await client.patch("/api/kg/user", json={"name": unique_name, "role": "e2e_tester"})
        r = await client.get("/api/kg/user")
        assert r.status_code == 200
        data = r.json()
        # Could be nested in a list from surreal query
        if isinstance(data, list):
            data = data[0] if data else {}
        assert data.get("name") == unique_name or unique_name in str(data)


class TestRoundTripWiki:
    async def test_put_then_get_wiki(self, client: httpx.AsyncClient):
        path = _uid("rt_wiki")
        content = "Round trip wiki content for E2E"
        await client.put(f"/api/kg/wiki/{path}", json={"content": content})
        r = await client.get(f"/api/kg/wiki/{path}")
        assert r.status_code == 200
        data = r.json()
        if isinstance(data, list):
            data = data[0] if data else {}
        assert data.get("content") == content or content in str(data)
