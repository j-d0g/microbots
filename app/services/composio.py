"""Composio service wrapper — auth-config discovery + OAuth initiation.

Two responsibilities:

1. **Discover** which toolkits the user has enabled in the Composio dashboard.
   Frontend calls ``GET /api/composio/toolkits`` and gets the live list without
   any ``ac_xxx`` IDs hard-coded anywhere in our backend.

2. **Initiate** the OAuth flow for a (user_id, toolkit, callback_url) tuple.
   Returns the redirect URL for the frontend to open in a popup.

The Composio SDK is synchronous, so network calls are wrapped in
``asyncio.to_thread`` to stay non-blocking inside FastAPI.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Optional

from composio import Composio
from composio_client import Composio as ComposioClient

logger = logging.getLogger(__name__)


@dataclass
class Toolkit:
    slug: str
    name: str
    auth_config_id: str


@dataclass
class InitiateResult:
    redirect_url: str
    connection_id: str
    status: str


@dataclass
class Connection:
    toolkit: str
    status: str
    id: str


class ComposioService:
    """Small wrapper around Composio's Python SDKs.

    Construct once per process — discovery results are cached in-process.
    """

    def __init__(self, api_key: Optional[str] = None) -> None:
        self._api_key = api_key or os.environ.get("COMPOSIO_API_KEY") or ""
        if not self._api_key:
            raise RuntimeError("COMPOSIO_API_KEY is not set")
        # `composio_client` is the low-level REST/listing client.
        self._client = ComposioClient(api_key=self._api_key)
        # `composio` is the higher-level SDK with connected_accounts.initiate().
        self._composio = Composio(api_key=self._api_key)
        self._toolkits_cache: Optional[list[Toolkit]] = None

    # ── Discovery ─────────────────────────────────────────────────────────

    async def list_toolkits(self, *, refresh: bool = False) -> list[Toolkit]:
        """Auto-discover enabled auth configs and return one entry per slug.

        If the user has two auth configs for the same toolkit (e.g. two Linear
        workspaces) we pick the first — you can override by passing a specific
        slug when initiating.
        """
        if self._toolkits_cache is not None and not refresh:
            return self._toolkits_cache

        def _list() -> list[Any]:
            res = self._client.auth_configs.list(limit=100)
            return list(getattr(res, "items", []) or [])

        items = await asyncio.to_thread(_list)
        seen: dict[str, Toolkit] = {}
        for a in items:
            d = a.model_dump() if hasattr(a, "model_dump") else a.__dict__
            if d.get("is_disabled"):
                continue
            tk = d.get("toolkit") or {}
            slug = tk.get("slug") if isinstance(tk, dict) else None
            if not slug:
                continue
            if slug in seen:
                continue
            seen[slug] = Toolkit(
                slug=slug,
                name=tk.get("name") or slug.title() if isinstance(tk, dict) else slug.title(),
                auth_config_id=d.get("id"),
            )
        self._toolkits_cache = sorted(seen.values(), key=lambda t: t.slug)
        return self._toolkits_cache

    async def _resolve_auth_config(self, toolkit_slug: str) -> str:
        toolkits = await self.list_toolkits()
        for t in toolkits:
            if t.slug == toolkit_slug.lower():
                return t.auth_config_id
        raise KeyError(toolkit_slug)

    # ── OAuth flow ────────────────────────────────────────────────────────

    async def initiate(
        self,
        *,
        user_id: str,
        toolkit: str,
        callback_url: str,
    ) -> InitiateResult:
        """Kick off a Composio connected-account OAuth flow.

        Returns the redirect URL for the frontend to open + a connection id
        the frontend can poll for status.
        """
        auth_config_id = await self._resolve_auth_config(toolkit)

        def _initiate() -> Any:
            return self._composio.connected_accounts.initiate(
                user_id=user_id,
                auth_config_id=auth_config_id,
                callback_url=callback_url,
            )

        req = await asyncio.to_thread(_initiate)
        return InitiateResult(
            redirect_url=getattr(req, "redirect_url", "") or "",
            connection_id=getattr(req, "id", "") or "",
            status=str(getattr(req, "status", "INITIATED") or "INITIATED"),
        )

    # ── Per-user status ──────────────────────────────────────────────────

    async def list_connections(self, user_id: str) -> list[Connection]:
        """Every connected account currently attached to this user."""

        def _list() -> list[Any]:
            res = self._client.connected_accounts.list(user_ids=[user_id], limit=100)
            return list(getattr(res, "items", []) or [])

        items = await asyncio.to_thread(_list)
        out: list[Connection] = []
        for a in items:
            d = a.model_dump() if hasattr(a, "model_dump") else a.__dict__
            tk = d.get("toolkit") or {}
            slug = tk.get("slug") if isinstance(tk, dict) else str(tk or "")
            out.append(Connection(
                toolkit=slug or "",
                status=str(d.get("status", "UNKNOWN")),
                id=str(d.get("id", "")),
            ))
        return out


@lru_cache(maxsize=1)
def get_composio_service() -> ComposioService:
    """Module-level singleton. FastAPI `Depends(get_composio_service)` uses this."""
    return ComposioService()
