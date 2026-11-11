"""E2E tests for the KG write (and write→read round-trip) REST endpoints.

These tests hit a REAL SurrealDB instance (ws://localhost:8000/rpc).
All test data is prefixed with ``test_e2e_`` to avoid collisions.

Run:
    uv run pytest app/tests/test_kg_api_e2e.py -v --tb=short
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from surrealdb import RecordID

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
                "memory", "entity", "skill", "workflow", "chat", "integration",
                "wiki_page", "wiki_page_revision",
            ]:
                await db.query(
                    f"DELETE {table} WHERE string::contains(string::lowercase(id), $uid)",
                    {"uid": _UID},
                )
            for edge_table in [
                "chat_yields", "memory_about", "appears_in",
                "co_used_with",
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


class TestMemoryEndpoints:
    async def test_memory_search_is_case_insensitive_and_scoped(self, client: httpx.AsyncClient):
        unique_token = f"UniqueSearchToken{_UID}"
        content = f"{_uid('search_memory')} {unique_token}"
        created = await client.post(
            "/api/kg/memories",
            json={"content": content, "confidence": 0.9},
        )
        assert created.status_code == 201

        response = await client.get(
            "/api/kg/search",
            params={"query": unique_token.lower(), "scope": "memories"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["scope"] == "memories"
        assert any(item["snippet"] == content for item in data["results"])

    async def test_integration_search_includes_incoming_co_used_with_edges(
        self, client: httpx.AsyncClient
    ):
        left = _uid("integration_left")
        right = _uid("integration_right")
        from app.services.surreal import session

        async with session() as db:
            await db.query(
                f"UPSERT integration:{left} CONTENT {{ slug: $slug, name: $name }}",
                {"slug": left, "name": left},
            )
            await db.query(
                f"UPSERT integration:{right} CONTENT {{ slug: $slug, name: $name }}",
                {"slug": right, "name": right},
            )
            await db.query(
                f"RELATE integration:{left}->co_used_with->integration:{right} "
                "CONTENT { frequency: 1 }"
            )

        try:
            response = await client.get(
                "/api/kg/search",
                params={"query": right, "scope": "all"},
            )
            assert response.status_code == 200
            hit = next(
                item for item in response.json()["results"]
                if item["kind"] == "integrations"
            )
            assert any(connection["slug"] == left for connection in hit["connections"])
        finally:
            async with session() as db:
                await db.query(
                    f"DELETE co_used_with WHERE in = integration:{left} "
                    f"OR out = integration:{left}"
                )
                await db.query(f"DELETE integration:{left}")
                await db.query(f"DELETE integration:{right}")

    async def test_search_prioritizes_named_hits_over_high_confidence_memories(
        self, client: httpx.AsyncClient
    ):
        entity_query = _uid("named_entity")
        workflow_query = _uid("named_workflow")
        entity_name = f"Person {entity_query}"
        workflow_entity_name = f"Updated {workflow_query} runbook with full pipeline"
        workflow_name = f"Workflow {workflow_query}"
        entity_memory = f"High-confidence note about {entity_query}"
        workflow_memory = f"High-confidence note about {workflow_query}"
        workflow_slug = _uid("named_workflow_slug")

        try:
            entity = await client.post(
                "/api/kg/entities",
                json={
                    "name": entity_name,
                    "entity_type": "person",
                    "description": "A search ranking test entity.",
                },
            )
            assert entity.status_code == 201
            memory = await client.post(
                "/api/kg/memories",
                json={"content": entity_memory, "confidence": 1.0},
            )
            assert memory.status_code == 201
            workflow_entity = await client.post(
                "/api/kg/entities",
                json={
                    "name": workflow_entity_name,
                    "entity_type": "document",
                    "description": "A longer named entity hit.",
                },
            )
            assert workflow_entity.status_code == 201

            workflow = await client.post(
                "/api/kg/workflows",
                json={
                    "slug": workflow_slug,
                    "name": workflow_name,
                    "description": "A search ranking test workflow.",
                },
            )
            assert workflow.status_code == 201
            memory = await client.post(
                "/api/kg/memories",
                json={"content": workflow_memory, "confidence": 1.0},
            )
            assert memory.status_code == 201

            entity_results = await client.get(
                "/api/kg/search",
                params={"query": entity_query, "scope": "all"},
            )
            workflow_results = await client.get(
                "/api/kg/search",
                params={"query": workflow_query, "scope": "all"},
            )
            assert entity_results.json()["results"][0]["kind"] == "entities"
            assert entity_results.json()["results"][0]["focus"] == entity.json()["id"]
            assert workflow_results.json()["results"][0]["kind"] == "workflows"
            assert workflow_results.json()["results"][0]["focus"] == workflow_slug
        finally:
            from app.services.surreal import session

            async with session() as db:
                await db.query("DELETE entity WHERE name = $name", {"name": entity_name})
                await db.query(
                    "DELETE entity WHERE name = $name",
                    {"name": workflow_entity_name},
                )
                await db.query(
                    "DELETE workflow WHERE slug = $slug",
                    {"slug": workflow_slug},
                )
                await db.query(
                    "DELETE memory WHERE content = $content",
                    {"content": entity_memory},
                )
                await db.query(
                    "DELETE memory WHERE content = $content",
                    {"content": workflow_memory},
                )

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


class TestGetEntities:
    async def test_entity_type_is_optional(self, client: httpx.AsyncClient):
        body = {"name": _uid("get_entity"), "entity_type": "person"}
        created = await client.post("/api/kg/entities", json=body)
        assert created.status_code == 201

        all_entities = await client.get("/api/kg/entities")
        filtered_entities = await client.get(
            "/api/kg/entities", params={"entity_type": "person"}
        )

        assert all_entities.status_code == 200
        assert filtered_entities.status_code == 200
        assert any(row["id"] == created.json()["id"] for row in all_entities.json())
        assert any(row["id"] == created.json()["id"] for row in filtered_entities.json())


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

    async def test_concurrent_idempotent_writes(self, client: httpx.AsyncClient):
        body = {
            "content": _uid("concurrent_chat"),
            "source_type": "ui_chat",
            "source_id": _uid("concurrent_source"),
        }
        responses = await asyncio.gather(
            *(client.post("/api/kg/chats", json=body) for _ in range(20))
        )
        assert all(response.status_code == 201 for response in responses)
        assert len({response.json()["id"] for response in responses}) == 1

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


class TestRelationEnrichment:
    async def test_entity_and_memory_relations_are_batched_into_response(
        self, client: httpx.AsyncClient
    ):
        entity_name = _uid("batch_entity")
        memory_content = _uid("batch_memory")
        integration_slug = _uid("batch_integration")
        entity_id = ""
        memory_id = ""
        chat_id = ""

        try:
            entity = await client.post(
                "/api/kg/entities",
                json={
                    "name": entity_name,
                    "entity_type": "person",
                    "description": "Batched relation test entity.",
                },
            )
            assert entity.status_code == 201
            entity_id = entity.json()["id"]

            memory = await client.post(
                "/api/kg/memories",
                json={"content": memory_content, "confidence": 1.0},
            )
            assert memory.status_code == 201
            memory_id = memory.json()["id"]

            chat = await client.post(
                "/api/kg/chats",
                json={
                    "content": _uid("batch_chat"),
                    "source_type": "synthetic",
                    "mentions": [
                        {"id": entity_id, "mention_type": "subject"},
                    ],
                },
            )
            assert chat.status_code == 201
            chat_id = chat.json()["id"]

            from app.services.surreal import session

            entity_key = entity_id.split(":", 1)[1]
            memory_key = memory_id.split(":", 1)[1]
            async with session() as db:
                await db.query(
                    f"UPSERT integration:{integration_slug} CONTENT "
                    f"{{ slug: '{integration_slug}', name: '{integration_slug}' }}"
                )
                await db.query(
                    f"RELATE entity:{entity_key}->appears_in"
                    f"->integration:{integration_slug} SET role = 'member'"
                )
                await db.query(
                    f"RELATE memory:{memory_key}->memory_about"
                    f"->integration:{integration_slug} SET relevance = 1.0"
                )

            entities = await client.get(
                "/api/kg/entities", params={"entity_type": "person"}
            )
            entity_row = next(
                row for row in entities.json() if row["id"] == entity_id
            )
            assert entity_row["chat_mention_count"] == 1
            assert entity_row["integration_slugs"] == [integration_slug]

            memories = await client.get(
                "/api/kg/memories", params={"by": "confidence", "limit": 200}
            )
            memory_row = next(
                row for row in memories.json() if row["id"] == memory_id
            )
            assert memory_row["integration_slugs"] == [integration_slug]
        finally:
            from app.services.surreal import session

            async with session() as db:
                if memory_id:
                    await db.query(
                        f"DELETE memory_about WHERE in = {memory_id}"
                    )
                    await db.query(f"DELETE {memory_id}")
                if entity_id:
                    await db.query(
                        f"DELETE appears_in WHERE in = {entity_id}"
                    )
                    await db.query(
                        f"DELETE chat_mentions WHERE out = {entity_id}"
                    )
                    await db.query(f"DELETE {entity_id}")
                if chat_id:
                    await db.query(f"DELETE {chat_id}")
                await db.query(f"DELETE integration:{integration_slug}")


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


class TestToday:
    async def test_today_surfaces_relevant_candidates_with_evidence(
        self, client: httpx.AsyncClient
    ):
        pr_id = RecordID("automation_candidate", "pr_review_summaries")
        linear_id = RecordID("automation_candidate", "linear_bug_triage")
        github_chat = RecordID("chat", "github_pr_schema")
        linear_chat = RecordID("chat", "linear_ticket_triage")
        bob_memory = RecordID("memory", "bob_reviewer")
        from app.services.surreal import session

        try:
            async with session() as db:
                for record_id, payload in [
                    (
                        github_chat,
                        {
                            "title": "PR schema review",
                            "content": "Bob reviewed the graph schema.",
                            "source_type": "github_pr",
                            "summary": "Bob reviewed the graph schema.",
                        },
                    ),
                    (
                        linear_chat,
                        {
                            "title": "Linear bug triage",
                            "content": "A bug was reported in #bugs.",
                            "source_type": "linear_ticket",
                            "summary": "A bug was reported in #bugs.",
                        },
                    ),
                    (
                        bob_memory,
                        {
                            "content": "Bob is the primary code reviewer.",
                            "memory_type": "fact",
                            "confidence": 0.9,
                        },
                    ),
                ]:
                    await db.query("UPSERT $id MERGE $payload", {
                        "id": record_id,
                        "payload": payload,
                    })
                for record_id, title, story, action, axes in [
                    (
                        pr_id,
                        "Draft PR review summaries for Bob",
                        "Bob is the primary reviewer.",
                        "Draft a concise review summary.",
                        {"kind": "automation", "risk_tier": 2},
                    ),
                    (
                        linear_id,
                        "Auto-file Linear tickets from #bugs",
                        "Bug reports in Slack recur.",
                        "Draft Linear tickets for review.",
                        {"kind": "automation", "risk_tier": 2},
                    ),
                ]:
                    await db.query("UPSERT $id MERGE $payload", {
                        "id": record_id,
                        "payload": {
                            "title": title,
                            "story": story,
                            "suggested_action": action,
                            "signal_axes": axes,
                        },
                    })
                for edge, source, target in [
                    ("candidate_evidence_chat", pr_id, github_chat),
                    ("candidate_evidence_memory", pr_id, bob_memory),
                    ("candidate_evidence_chat", linear_id, linear_chat),
                ]:
                    await db.query(
                        f"DELETE {edge} WHERE in = $source AND out = $target",
                        {"source": source, "target": target},
                    )
                    await db.query(
                        f"RELATE $source->{edge}->$target",
                        {"source": source, "target": target},
                    )

            response = await client.get("/api/kg/today", params={"user_id": "default"})
            assert response.status_code == 200
            data = response.json()
            assert set(data) == {"needs_you", "suggestions", "recent"}
            suggestions = {row["id"]: row for row in data["suggestions"]}
            pr = suggestions[str(pr_id)]
            linear = suggestions[str(linear_id)]
            assert pr["signal_axes"]["risk_tier"] >= 2
            assert {item["id"] for item in pr["evidence"]} >= {
                str(github_chat),
                str(bob_memory),
            }
            assert any(item["id"] == str(linear_chat) for item in linear["evidence"])
            assert all(
                not (
                    (row["signal_axes"].get("risk_tier") == 1)
                    and row["signal_axes"].get("kind") not in {
                        "question",
                        "automation",
                        "workflow_promotion",
                    }
                )
                for row in [*data["needs_you"], *data["suggestions"]]
            )
            assert len(data["recent"]) <= 5
            assert all("title" in row and "source_type" in row for row in data["recent"])
            timestamps = [
                datetime.fromisoformat(row["occurred_at"].replace("Z", "+00:00"))
                for row in data["recent"]
                if row.get("occurred_at")
            ]
            assert timestamps == sorted(timestamps, reverse=True)
        finally:
            async with session() as db:
                await db.query(
                    "DELETE candidate_evidence_chat WHERE in IN [$pr, $linear]",
                    {"pr": pr_id, "linear": linear_id},
                )
                await db.query(
                    "DELETE candidate_evidence_memory WHERE in = $pr",
                    {"pr": pr_id},
                )
                for record_id in [pr_id, linear_id, github_chat, linear_chat, bob_memory]:
                    await db.query("DELETE $id", {"id": record_id})

    async def test_answering_a_question_candidate_marks_it_done_and_remembers(
        self, client: httpx.AsyncClient
    ):
        record = RecordID("automation_candidate", _uid("today_answer"))
        title = f"Who owns the deploy runbook now? {record.id}"
        from app.services.surreal import session

        async with session() as db:
            await db.query(
                "UPSERT $id CONTENT $candidate",
                {
                    "id": record,
                    "candidate": {
                        "title": title,
                        "story": "The runbook needs a current owner.",
                        "suggested_action": "Confirm the owner.",
                        "signal_axes": {
                            "kind": "question",
                            "risk_tier": 1,
                            "options": ["Desmond", "Jordan"],
                        },
                        "status": "open",
                    },
                },
            )
        try:
            rejected = await client.post(
                f"/api/kg/candidates/{record}",
                json={"status": "accepted", "answer": "Desmond"},
            )
            assert rejected.status_code == 422

            answered = await client.post(
                f"/api/kg/candidates/{record}",
                json={"status": "done", "answer": "  Desmond  "},
            )
            assert answered.status_code == 200
            assert answered.json()["status"] == "done"
            assert answered.json()["answer"] == "Desmond"

            today = await client.get("/api/kg/today")
            assert today.status_code == 200
            assert all(
                row["id"] != str(record) for row in today.json()["needs_you"]
            ), "answered questions should leave needs_you"

            memories = await client.get(
                "/api/kg/memories", params={"by": "recency", "limit": 100}
            )
            assert memories.status_code == 200
            decision = next(
                row for row in memories.json()
                if row["content"] == f"{title}: Desmond"
            )
            assert decision["memory_type"] == "decision"

            undone = await client.post(
                f"/api/kg/candidates/{record}",
                json={"status": "open"},
            )
            assert undone.status_code == 200
            assert undone.json().get("answer") is None
        finally:
            async with session() as db:
                await db.query("DELETE $id", {"id": record})
                await db.query(
                    "DELETE memory WHERE content = $content",
                    {"content": f"{title}: Desmond"},
                )

    async def test_today_prioritizes_soon_candidates_and_surfaces_questions(
        self, client: httpx.AsyncClient
    ):
        question_id = RecordID("automation_candidate", _uid("today_question"))
        soon_id = RecordID("automation_candidate", _uid("today_soon"))
        later_id = RecordID("automation_candidate", _uid("today_later"))
        hygiene_id = RecordID("automation_candidate", _uid("today_hygiene"))
        records = [
            (
                question_id,
                {"kind": "question", "risk_tier": 1},
                datetime.now(timezone.utc) + timedelta(days=3),
            ),
            (soon_id, {"kind": "automation", "risk_tier": 2}, datetime.now(timezone.utc) + timedelta(days=2)),
            (later_id, {"kind": "automation", "risk_tier": 2}, datetime.now(timezone.utc) + timedelta(days=14)),
            (hygiene_id, {"kind": "hygiene", "risk_tier": 1}, datetime.now(timezone.utc) + timedelta(days=1)),
        ]
        from app.services.surreal import session

        try:
            async with session() as db:
                for record_id, axes, deadline in records:
                    await db.query(
                        "UPSERT $id CONTENT $candidate",
                        {
                            "id": record_id,
                            "candidate": {
                                "title": str(record_id),
                                "story": "Test candidate.",
                                "suggested_action": "Review this candidate.",
                                "signal_axes": axes,
                                **({"time_sensitive_until": deadline} if deadline else {}),
                            },
                        },
                    )
            response = await client.get("/api/kg/today")
            assert response.status_code == 200
            data = response.json()
            needs_ids = {row["id"] for row in data["needs_you"]}
            assert str(question_id) in needs_ids
            assert str(soon_id) in needs_ids
            assert str(later_id) not in needs_ids
            assert str(hygiene_id) not in {
                row["id"] for row in [*data["needs_you"], *data["suggestions"]]
            }
            suggestion_ids = [row["id"] for row in data["suggestions"]]
            assert suggestion_ids.index(str(soon_id)) < suggestion_ids.index(str(later_id))
        finally:
            async with session() as db:
                for record_id, _, _ in records:
                    await db.query("DELETE $id", {"id": record_id})

    async def test_today_excludes_ui_chats_and_uses_recent_text_fallbacks(
        self, client: httpx.AsyncClient
    ):
        ui_chat = RecordID("chat", _uid("today_ui_chat"))
        summary_chat = RecordID("chat", _uid("today_summary_chat"))
        content_chat = RecordID("chat", _uid("today_content_chat"))
        from app.services.surreal import session

        timestamp = datetime.now(timezone.utc) + timedelta(days=30)
        try:
            async with session() as db:
                for record_id, payload in [
                    (
                        ui_chat,
                        {
                            "title": "Own app chat",
                            "source_type": "ui_chat",
                            "content": "Do not show",
                            "occurred_at": timestamp,
                        },
                    ),
                    (
                        summary_chat,
                        {
                            "summary": "Slack incident summary",
                            "source_type": "slack_thread",
                            "content": "Incident content",
                            "occurred_at": timestamp - timedelta(minutes=1),
                        },
                    ),
                    (
                        content_chat,
                        {
                            "source_type": "github_pr",
                            "content": "x" * 100,
                            "occurred_at": timestamp - timedelta(minutes=2),
                        },
                    ),
                ]:
                    await db.query("UPSERT $id MERGE $payload", {
                        "id": record_id,
                        "payload": payload,
                    })

            response = await client.get("/api/kg/today")
            assert response.status_code == 200
            recent = response.json()["recent"]
            by_id = {row["id"]: row for row in recent}
            assert str(ui_chat) not in by_id
            assert by_id[str(summary_chat)]["title"] == "Slack incident summary"
            assert by_id[str(content_chat)]["title"] == "x" * 80
        finally:
            async with session() as db:
                for record_id in [ui_chat, summary_chat, content_chat]:
                    await db.query("DELETE $id", {"id": record_id})

    async def test_candidate_status_update_and_undo(self, client: httpx.AsyncClient):
        candidate_id = _uid("today_candidate")
        record = RecordID("automation_candidate", candidate_id)
        from app.services.surreal import session

        async with session() as db:
            await db.query(
                "UPSERT $id CONTENT $candidate",
                {
                    "id": record,
                    "candidate": {
                        "title": "Test candidate",
                        "story": "Test story",
                        "suggested_action": "Review it",
                        "signal_axes": {"kind": "automation", "risk_tier": 2},
                    },
                },
            )
        try:
            accepted = await client.post(
                f"/api/kg/candidates/{record}",
                json={"status": "accepted"},
            )
            assert accepted.status_code == 200
            assert accepted.json()["status"] == "accepted"
            assert accepted.json()["updated_at"]
            today = await client.get("/api/kg/today")
            accepted_row = next(
                row for row in today.json()["suggestions"]
                if row["id"] == str(record)
            )
            assert accepted_row["status"] == "accepted"

            undone = await client.post(
                f"/api/kg/candidates/{record}",
                json={"status": "open"},
            )
            assert undone.status_code == 200
            assert undone.json()["status"] == "open"
        finally:
            async with session() as db:
                await db.query("DELETE $id", {"id": record})
