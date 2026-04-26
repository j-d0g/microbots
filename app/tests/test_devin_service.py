"""Unit tests for ``app/services/devin.py``.

We mock the HTTP layer with ``httpx.MockTransport`` so the suite never reaches
the real Devin API. Each test pins one endpoint contract — the goal is to
catch a regression where we silently change the request / response shape.
"""

from __future__ import annotations

import io
import json

import httpx
import pytest

from app.services.devin import (
    DevinAPIError,
    DevinConfigError,
    DevinService,
)


# ─── Helpers ──────────────────────────────────────────────────────────────


def _make_service(handler) -> DevinService:
    """Build a DevinService whose internal AsyncClient uses our mock transport."""
    transport = httpx.MockTransport(handler)
    svc = DevinService(api_key="apk_test_xyz", base_url="https://example.test/v1")

    # Monkey-patch _request to route through our transport. We intercept at
    # the AsyncClient level so the rest of the wrapper is exercised normally.
    real_request = svc._request

    async def _routed(method: str, path: str, *, json=None, params=None, files=None):
        async with httpx.AsyncClient(transport=transport, base_url="https://example.test/v1") as client:
            headers = svc._headers(json_body=files is None)
            resp = await client.request(method, path, headers=headers, json=json, params=params, files=files)
            if resp.status_code >= 400:
                try:
                    detail = resp.json()
                except Exception:
                    detail = resp.text
                raise DevinAPIError(resp.status_code, detail, endpoint=path)
            if not resp.content:
                return None
            ctype = resp.headers.get("content-type", "")
            if ctype.startswith("application/json"):
                return resp.json()
            return resp.text

    svc._request = _routed  # type: ignore[method-assign]
    return svc


# ─── Configuration ────────────────────────────────────────────────────────


def test_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv("DEVIN_API_KEY", raising=False)
    with pytest.raises(DevinConfigError):
        DevinService()


# ─── Sessions ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_session_sends_prompt_and_optionals():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        captured["headers"] = dict(req.headers)
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(
            200,
            json={"session_id": "devin-abc", "url": "https://app.devin.ai/sessions/devin-abc", "is_new_session": True},
        )

    svc = _make_service(handler)
    out = await svc.create_session(
        prompt="hello",
        title="t",
        tags=["user:1"],
        structured_output_schema={"type": "object"},
    )

    assert out.session_id == "devin-abc"
    assert out.url.endswith("devin-abc")
    assert out.is_new_session is True
    assert captured["url"].endswith("/sessions")
    assert captured["headers"]["authorization"].startswith("Bearer ")
    assert captured["body"]["prompt"] == "hello"
    assert captured["body"]["title"] == "t"
    assert captured["body"]["tags"] == ["user:1"]
    assert captured["body"]["structured_output_schema"] == {"type": "object"}
    # None-valued optional fields should be dropped, not sent as null.
    assert "playbook_id" not in captured["body"]


@pytest.mark.asyncio
async def test_list_sessions_strips_empty_filters():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        return httpx.Response(200, json={"sessions": []})

    svc = _make_service(handler)
    rows = await svc.list_sessions(limit=10, offset=5)
    assert rows == []
    assert "limit=10" in captured["url"]
    assert "offset=5" in captured["url"]
    assert "tags=" not in captured["url"]
    assert "user_email" not in captured["url"]


@pytest.mark.asyncio
async def test_get_session_returns_dict():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "session_id": "devin-abc",
                "status": "running",
                "status_enum": "working",
                "messages": [{"text": "hi"}],
            },
        )

    svc = _make_service(handler)
    data = await svc.get_session("devin-abc")
    assert data["session_id"] == "devin-abc"
    assert data["status_enum"] == "working"
    assert data["messages"][0]["text"] == "hi"


@pytest.mark.asyncio
async def test_get_session_404_raises_devin_api_error():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "not found"})

    svc = _make_service(handler)
    with pytest.raises(DevinAPIError) as ei:
        await svc.get_session("devin-missing")
    assert ei.value.status == 404


@pytest.mark.asyncio
async def test_send_message_posts_to_message_path():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["path"] = req.url.path
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(200, json={"detail": "queued"})

    svc = _make_service(handler)
    out = await svc.send_message("devin-abc", "please retry tests")
    assert out["detail"] == "queued"
    assert captured["path"].endswith("/sessions/devin-abc/message")
    assert captured["body"] == {"message": "please retry tests"}


@pytest.mark.asyncio
async def test_terminate_session_uses_delete():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["method"] = req.method
        captured["path"] = req.url.path
        return httpx.Response(200, json={"detail": "terminated"})

    svc = _make_service(handler)
    out = await svc.terminate_session("devin-abc")
    assert out["detail"] == "terminated"
    assert captured["method"] == "DELETE"
    assert captured["path"].endswith("/sessions/devin-abc")


@pytest.mark.asyncio
async def test_update_tags_uses_put():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["method"] = req.method
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(200, json={"detail": "ok"})

    svc = _make_service(handler)
    await svc.update_tags("devin-abc", ["user:1", "run:42"])
    assert captured["method"] == "PUT"
    assert captured["body"] == {"tags": ["user:1", "run:42"]}


# ─── Attachments ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_attachment_returns_url_string():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["content_type"] = req.headers.get("content-type", "")
        return httpx.Response(200, json="https://files.devin.ai/abc.txt")

    svc = _make_service(handler)
    url = await svc.upload_attachment(
        file=io.BytesIO(b"hello"),
        filename="hello.txt",
        content_type="text/plain",
    )
    assert url == "https://files.devin.ai/abc.txt"
    assert captured["content_type"].startswith("multipart/form-data")


def test_attachment_ref_format():
    assert DevinService.attachment_ref("https://x.com/a") == 'ATTACHMENT:"https://x.com/a"'


def test_terminal_status_helper():
    assert DevinService.is_terminal_status("finished") is True
    assert DevinService.is_terminal_status("expired") is True
    assert DevinService.is_terminal_status("working") is False
    assert DevinService.is_terminal_status(None) is False
