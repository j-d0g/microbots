"""/api/composio/* — the frontend's entry point for per-user OAuth.

Three endpoints, all auto-discovering Composio auth configs on the fly so
the frontend never has to know any ``ac_xxx`` IDs.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.services.composio import ComposioService, get_composio_service

router = APIRouter(prefix="/composio", tags=["composio"])


# ─── Request / response models ────────────────────────────────────────────


class ConnectRequest(BaseModel):
    """Body for POST /api/composio/connect."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    user_id: str = Field(..., description="Opaque user identifier from the frontend.", min_length=1)
    toolkit: str = Field(..., description="Toolkit slug — slack / github / gmail / linear / notion / perplexityai.", min_length=1)
    callback_url: str = Field(..., description="URL Composio redirects to after the user completes consent.", min_length=1)


class ConnectResponse(BaseModel):
    redirect_url: str = Field(..., description="Open this in a popup / new tab; Composio hosts the consent screen.")
    connection_id: str = Field(..., description="Composio connected_account id (status=INITIATED until consent completes).")
    status: str


class ConnectionOut(BaseModel):
    toolkit: str
    status: str
    id: str


class ConnectionsResponse(BaseModel):
    user_id: str
    connections: list[ConnectionOut]


class ToolkitOut(BaseModel):
    slug: str
    name: str
    auth_config_id: str


class ToolkitsResponse(BaseModel):
    toolkits: list[ToolkitOut]


# ─── Endpoints ────────────────────────────────────────────────────────────


@router.get("/toolkits", response_model=ToolkitsResponse)
async def list_toolkits(
    svc: ComposioService = Depends(get_composio_service),
) -> ToolkitsResponse:
    """Auto-discovered list of toolkits enabled for this Composio account.

    No configuration lives in the backend — whatever auth configs the admin
    creates in the Composio dashboard will appear here automatically.
    """
    tks = await svc.list_toolkits()
    return ToolkitsResponse(
        toolkits=[ToolkitOut(slug=t.slug, name=t.name, auth_config_id=t.auth_config_id) for t in tks]
    )


@router.post("/connect", response_model=ConnectResponse)
async def connect(
    body: ConnectRequest,
    svc: ComposioService = Depends(get_composio_service),
) -> ConnectResponse:
    """Kick off a Composio OAuth flow for ``(user_id, toolkit)``.

    The frontend opens ``response.redirect_url`` in a popup / new tab. Composio
    hosts the consent screen; once the user approves, Composio redirects them
    to ``callback_url`` with ``?status=success&connected_account_id=ca_...&user_id=...``.
    """
    try:
        result = await svc.initiate(
            user_id=body.user_id,
            toolkit=body.toolkit,
            callback_url=body.callback_url,
        )
    except KeyError as e:
        available = [t.slug for t in await svc.list_toolkits()]
        raise HTTPException(
            status_code=400,
            detail=f"Unknown toolkit {str(e)!r}. Available: {available}",
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Composio error: {type(e).__name__}: {e}")

    return ConnectResponse(
        redirect_url=result.redirect_url,
        connection_id=result.connection_id,
        status=result.status,
    )


@router.get("/connections", response_model=ConnectionsResponse)
async def list_connections(
    user_id: str,
    svc: ComposioService = Depends(get_composio_service),
) -> ConnectionsResponse:
    """Every Composio connection attached to ``user_id``, regardless of status.

    ``status`` is one of ``INITIATED`` / ``ACTIVE`` / ``EXPIRED`` / ``FAILED``.
    Poll this after ``/connect`` to detect the moment the user completes OAuth.
    """
    conns = await svc.list_connections(user_id)
    return ConnectionsResponse(
        user_id=user_id,
        connections=[ConnectionOut(toolkit=c.toolkit, status=c.status, id=c.id) for c in conns],
    )
