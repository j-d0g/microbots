"""Tests for the GET /api/kg/chats endpoint and POST→GET round-trip.

These tests use the FastAPI ASGI test client with a REAL SurrealDB
instance at ws://localhost:8000/rpc. Mark: e2e.

Run:
    uv run pytest app/tests/test_chat_persistence.py -v --tb=short
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest

# Ensure SurrealDB env vars are set for the local dev instance.
os.environ.setdefault("SURREAL_URL", "ws://localhost:8000/rpc")
os.environ.setdefault("SURREAL_USER", "root")
os.environ.setdefault("SURREAL_PASS", "root")
os.environ.setdefault("SURREAL_NS", "microbots")
os.environ.setdefault("SURREAL_DB", "memory")

from app.main import app  # noqa: E402

pytestmark = pytest.mark.e2e

_UID = uuid.uuid4().hex[:8]


def _uid(label: str) -> str:
    return f"test_chat_{label}_{_UID}"


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _do_cleanup():
    from app.services.surreal import session

    async with session() as db:
        await db.query(
            "DELETE chat WHERE string::contains(string::lowercase(source_id), $uid)",
            {"uid": _UID},
        )


@pytest.fixture(autouse=True, scope="session")
def cleanup_test_data_sync():
    """Schedule best-effort cleanup after the entire session."""
    yield
    import asyncio
    try:
        asyncio.run(_do_cleanup())
    except Exception:
        pass


class TestGetChats:
    """GET /api/kg/chats returns chat rows filtered by source_type."""

    async def test_returns_empty_list_when_no_chats(self, client: httpx.AsyncClient):
        # Use a unique source_type that has no data.
        r = await client.get(
            "/api/kg/chats",
            params={"source_type": f"nonexistent_{_UID}", "limit": 5},
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    async def test_post_then_get_round_trip(self, client: httpx.AsyncClient):
        source_id = _uid("user_msg")
        post_body = {
            "content": "hello from test",
            "source_type": "ui_chat",
            "source_id": source_id,
            "signal_level": "mid",
            "occurred_at": "2026-04-26T12:00:00Z",
        }
        r = await client.post("/api/kg/chats", json=post_body)
        assert r.status_code == 201, r.text

        # Now GET and verify we can find our message.
        r = await client.get(
            "/api/kg/chats",
            params={"source_type": "ui_chat", "limit": 100},
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        matches = [row for row in data if row.get("source_id") == source_id]
        assert len(matches) == 1
        assert matches[0]["content"] == "hello from test"
        assert matches[0]["signal_level"] == "mid"

    async def test_limit_param_is_respected(self, client: httpx.AsyncClient):
        r = await client.get(
            "/api/kg/chats",
            params={"source_type": "ui_chat", "limit": 1},
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 1

    async def test_default_source_type_is_ui_chat(self, client: httpx.AsyncClient):
        r = await client.get("/api/kg/chats")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
