"""Devin API service wrapper — typed httpx client for the v1 surface.

Single source of truth for every Devin API call we make. The MCP tool layer
(``app/mcp/devin_tools.py``) and the REST mirror (``app/routes/api_devin.py``)
both go through this module so the behaviour stays in lockstep.

Targets the v1 endpoints documented at
https://docs.devin.ai/api-reference/v1/overview — flat ``/v1/sessions/...`` URLs
with a service or personal API key in the ``Authorization: Bearer`` header.

Auth + base URL are read from the environment:

    DEVIN_API_KEY     required — service key (apk_*) or personal key (apk_user_*)
    DEVIN_API_BASE    optional — defaults to ``https://api.devin.ai/v1``
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, BinaryIO, Optional

import httpx

logger = logging.getLogger(__name__)


# ─── Errors ───────────────────────────────────────────────────────────────


class DevinError(RuntimeError):
    """Base class for every error this module raises."""


class DevinConfigError(DevinError):
    """Missing or invalid environment configuration."""


class DevinAPIError(DevinError):
    """Non-2xx response from the Devin API.

    ``status`` is the HTTP code; ``detail`` is whatever the API returned (best-effort
    JSON parse, falls back to text).
    """

    def __init__(self, status: int, detail: Any, *, endpoint: str = "") -> None:
        self.status = status
        self.detail = detail
        self.endpoint = endpoint
        super().__init__(f"Devin API {status} on {endpoint}: {detail!r}")


# ─── Domain types (lightweight; we keep responses as dicts for forward-compat) ──


@dataclass(slots=True)
class CreatedSession:
    """Response shape for ``POST /v1/sessions``."""

    session_id: str
    url: str
    is_new_session: bool = True
    raw: dict[str, Any] = field(default_factory=dict)


# ─── Service ──────────────────────────────────────────────────────────────


# Terminal states reported by the Devin API. Used by polling loops to decide
# when to stop. ``working`` / ``resumed`` / ``resume_requested`` mean Devin is
# still active. See the v1 sessions schema for the full list.
TERMINAL_STATUSES = frozenset({"finished", "expired"})
ACTIVE_STATUSES = frozenset({
    "working",
    "blocked",
    "suspend_requested",
    "suspend_requested_frontend",
    "resume_requested",
    "resume_requested_frontend",
    "resumed",
})


class DevinService:
    """Async httpx wrapper around the Devin v1 API.

    Construct once per process via ``get_devin_service()``. Each request opens
    a short-lived ``httpx.AsyncClient`` so we play nice with FastAPI's worker
    model and never hold half-broken sockets across reloads.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key or os.environ.get("DEVIN_API_KEY") or ""
        if not self._api_key:
            raise DevinConfigError("DEVIN_API_KEY is not set in the environment")
        self._base_url = (base_url or os.environ.get("DEVIN_API_BASE") or "https://api.devin.ai/v1").rstrip("/")
        self._timeout = timeout

    # ── Plumbing ──────────────────────────────────────────────────────────

    def _headers(self, *, json_body: bool = True) -> dict[str, str]:
        h = {"Authorization": f"Bearer {self._api_key}"}
        if json_body:
            h["Content-Type"] = "application/json"
        return h

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
        files: Optional[dict[str, Any]] = None,
    ) -> Any:
        """Single HTTP roundtrip with consistent auth + error handling.

        On non-2xx responses we raise ``DevinAPIError`` with the parsed detail —
        the caller decides whether to surface that to the agent or remap it
        (e.g. 404 → ``None``).
        """
        url = f"{self._base_url}{path}"
        headers = self._headers(json_body=files is None)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.request(
                    method,
                    url,
                    headers=headers,
                    json=json,
                    params=params,
                    files=files,
                )
            except httpx.HTTPError as e:
                logger.exception("devin %s %s failed before reaching the server", method, path)
                raise DevinAPIError(0, f"network error: {type(e).__name__}: {e}", endpoint=path) from e

        if resp.status_code >= 400:
            try:
                detail = resp.json()
            except Exception:  # noqa: BLE001
                detail = resp.text
            raise DevinAPIError(resp.status_code, detail, endpoint=path)

        if not resp.content:
            return None
        # The attachments endpoint returns a bare JSON string ("https://…").
        ctype = resp.headers.get("content-type", "")
        if ctype.startswith("application/json"):
            return resp.json()
        return resp.text

    # ── Sessions ──────────────────────────────────────────────────────────

    async def create_session(
        self,
        *,
        prompt: str,
        title: Optional[str] = None,
        tags: Optional[list[str]] = None,
        playbook_id: Optional[str] = None,
        knowledge_ids: Optional[list[str]] = None,
        secret_ids: Optional[list[str]] = None,
        session_secrets: Optional[list[dict[str, Any]]] = None,
        snapshot_id: Optional[str] = None,
        max_acu_limit: Optional[int] = None,
        idempotent: bool = False,
        unlisted: bool = False,
        structured_output_schema: Optional[dict[str, Any]] = None,
    ) -> CreatedSession:
        """Create a new Devin session.

        ``structured_output_schema`` (JSON Schema Draft 7, ≤64KB) is the recommended
        way to get a typed result back — Devin will validate against it and the
        result lands in the session's ``structured_output`` field. Use this for
        "did the build pass?" / "what PR did Devin open?" instead of parsing
        free-text messages.
        """
        body: dict[str, Any] = {"prompt": prompt, "idempotent": idempotent, "unlisted": unlisted}
        for k, v in {
            "title": title,
            "tags": tags,
            "playbook_id": playbook_id,
            "knowledge_ids": knowledge_ids,
            "secret_ids": secret_ids,
            "session_secrets": session_secrets,
            "snapshot_id": snapshot_id,
            "max_acu_limit": max_acu_limit,
            "structured_output_schema": structured_output_schema,
        }.items():
            if v is not None:
                body[k] = v
        data = await self._request("POST", "/sessions", json=body)
        if not isinstance(data, dict):
            raise DevinAPIError(0, f"unexpected create_session response: {data!r}", endpoint="/sessions")
        return CreatedSession(
            session_id=str(data.get("session_id", "")),
            url=str(data.get("url", "")),
            is_new_session=bool(data.get("is_new_session", True)),
            raw=data,
        )

    async def list_sessions(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
        tags: Optional[list[str]] = None,
        user_email: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """List sessions. Returns the ``sessions`` array from the API.

        ``tags`` / ``user_email`` are useful for filtering by the planner-
        attached attribution tags (``user:<id>``, ``run:<run_id>``).
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if tags:
            params["tags"] = tags
        if user_email:
            params["user_email"] = user_email
        data = await self._request("GET", "/sessions", params=params)
        if isinstance(data, dict):
            return list(data.get("sessions") or [])
        if isinstance(data, list):
            return data
        return []

    async def get_session(self, session_id: str) -> dict[str, Any]:
        """Full session record incl. ``status_enum``, ``messages``, ``structured_output``."""
        data = await self._request("GET", f"/sessions/{session_id}")
        if not isinstance(data, dict):
            raise DevinAPIError(0, f"unexpected get_session response: {data!r}", endpoint=f"/sessions/{session_id}")
        return data

    async def send_message(self, session_id: str, message: str) -> dict[str, Any]:
        """Push a mid-run instruction to a running session."""
        data = await self._request(
            "POST",
            f"/sessions/{session_id}/message",
            json={"message": message},
        )
        return data if isinstance(data, dict) else {"detail": str(data) if data is not None else "ok"}

    async def terminate_session(self, session_id: str) -> dict[str, Any]:
        """Cancel a session. Once terminated it cannot be resumed."""
        data = await self._request("DELETE", f"/sessions/{session_id}")
        return data if isinstance(data, dict) else {"detail": str(data) if data is not None else "ok"}

    async def update_tags(self, session_id: str, tags: list[str]) -> dict[str, Any]:
        """Replace the tag set on a session. Useful for late attribution."""
        data = await self._request(
            "PUT",
            f"/sessions/{session_id}/tags",
            json={"tags": tags},
        )
        return data if isinstance(data, dict) else {"detail": str(data) if data is not None else "ok"}

    # ── Attachments ───────────────────────────────────────────────────────

    async def upload_attachment(self, *, file: BinaryIO, filename: str, content_type: Optional[str] = None) -> str:
        """Upload a file and return the attachment URL.

        Devin only recognises attachments referenced as ``ATTACHMENT:"<url>"`` on
        a line by itself in the prompt. Use ``attachment_ref(url)`` to format
        the line correctly.
        """
        files = {"file": (filename, file, content_type or "application/octet-stream")}
        data = await self._request("POST", "/attachments", files=files)
        if isinstance(data, str):
            return data
        if isinstance(data, dict) and "url" in data:
            return str(data["url"])
        raise DevinAPIError(0, f"unexpected attachment response: {data!r}", endpoint="/attachments")

    # ── Convenience helpers ───────────────────────────────────────────────

    @staticmethod
    def attachment_ref(url: str) -> str:
        """Render the exact ``ATTACHMENT:"<url>"`` line Devin expects."""
        return f'ATTACHMENT:"{url}"'

    @staticmethod
    def is_terminal_status(status_enum: Optional[str]) -> bool:
        """True iff the session has reached a state from which it won't progress."""
        return status_enum in TERMINAL_STATUSES


@lru_cache(maxsize=1)
def get_devin_service() -> DevinService:
    """Module-level singleton. FastAPI ``Depends(get_devin_service)`` uses this."""
    return DevinService()
