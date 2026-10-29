from __future__ import annotations

import httpx
import pytest


@pytest.mark.asyncio
async def test_composio_toolkits_returns_cors_503_without_key(monkeypatch):
    from app.main import app
    from app.services.composio import get_composio_service

    monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)
    get_composio_service.cache_clear()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            response = await client.get(
                "/api/composio/toolkits",
                headers={"Origin": "http://localhost:3000"},
            )
        assert response.status_code == 503
        assert response.json() == {"error": "composio not configured"}
        assert response.headers["access-control-allow-origin"] == "*"
    finally:
        get_composio_service.cache_clear()
