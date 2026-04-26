"""/api/devin/* — REST mirror of the Devin MCP tools + SSE log stream.

The MCP server (mounted at ``/mcp/devin``) is for LLM agents. Vanilla JS
clients want plain JSON, and the UX needs a push-style log feed — neither
of which fits the MCP wire protocol cleanly.

This router exposes:

  POST   /api/devin/sessions                     create
  GET    /api/devin/sessions                     list
  GET    /api/devin/sessions/{id}                full session
  POST   /api/devin/sessions/{id}/messages       send mid-run instruction
  PUT    /api/devin/sessions/{id}/tags           replace tag set
  DELETE /api/devin/sessions/{id}                terminate
  GET    /api/devin/sessions/{id}/stream         SSE log stream (one connection
                                                 per UX tab; many tabs share one
                                                 upstream poller)
  POST   /api/devin/attachments                  upload file → URL
  GET    /api/devin/health                       reachability check

Every handler delegates to ``app.services.devin.DevinService`` so the REST,
MCP, and poller layers always agree on what the API returns.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.services.devin import DevinAPIError, DevinService, get_devin_service
from app.services.devin_poller import DevinPoller, get_devin_poller

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/devin", tags=["devin"])


# ─── Request / response models ────────────────────────────────────────────


class CreateSessionBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    prompt: str = Field(..., min_length=1)
    title: Optional[str] = None
    tags: Optional[list[str]] = Field(default=None, max_length=50)
    playbook_id: Optional[str] = None
    knowledge_ids: Optional[list[str]] = None
    secret_ids: Optional[list[str]] = None
    snapshot_id: Optional[str] = None
    max_acu_limit: Optional[int] = Field(default=None, gt=0)
    idempotent: bool = False
    unlisted: bool = False
    structured_output_schema: Optional[dict[str, Any]] = None


class SendMessageBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    message: str = Field(..., min_length=1)


class UpdateTagsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tags: list[str] = Field(..., max_length=50)


# ─── Plumbing ─────────────────────────────────────────────────────────────


def _raise(e: DevinAPIError) -> None:
    """Translate a DevinAPIError into an HTTPException with the upstream payload."""
    # Map a couple of canonical codes; treat everything else as a 502 so the
    # UX can distinguish "your request was bad" (4xx) from "Devin is sad" (5xx).
    status_map = {0: 502, 401: 401, 403: 403, 404: 404, 422: 422, 429: 429}
    code = status_map.get(e.status, 502 if e.status >= 500 else 400)
    raise HTTPException(status_code=code, detail={"endpoint": e.endpoint, "upstream_status": e.status, "detail": e.detail})


# ─── Sessions ─────────────────────────────────────────────────────────────


@router.post("/sessions")
async def create_session(
    body: CreateSessionBody,
    svc: DevinService = Depends(get_devin_service),
) -> dict[str, Any]:
    try:
        created = await svc.create_session(**body.model_dump(exclude_none=True))
    except DevinAPIError as e:
        _raise(e)
    return {
        "session_id": created.session_id,
        "url": created.url,
        "is_new_session": created.is_new_session,
    }


@router.get("/sessions")
async def list_sessions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    tag: Optional[list[str]] = Query(None, description="Repeat to AND filter (e.g. ?tag=user:42&tag=run:abc)."),
    user_email: Optional[str] = Query(None),
    svc: DevinService = Depends(get_devin_service),
) -> dict[str, Any]:
    try:
        rows = await svc.list_sessions(limit=limit, offset=offset, tags=tag, user_email=user_email)
    except DevinAPIError as e:
        _raise(e)
    return {"sessions": rows, "count": len(rows)}


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    svc: DevinService = Depends(get_devin_service),
) -> dict[str, Any]:
    try:
        return await svc.get_session(session_id)
    except DevinAPIError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail=f"session {session_id!r} not found")
        _raise(e)


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    body: SendMessageBody,
    svc: DevinService = Depends(get_devin_service),
) -> dict[str, Any]:
    try:
        return await svc.send_message(session_id, body.message)
    except DevinAPIError as e:
        _raise(e)


@router.put("/sessions/{session_id}/tags")
async def update_tags(
    session_id: str,
    body: UpdateTagsBody,
    svc: DevinService = Depends(get_devin_service),
) -> dict[str, Any]:
    try:
        return await svc.update_tags(session_id, body.tags)
    except DevinAPIError as e:
        _raise(e)


@router.delete("/sessions/{session_id}")
async def terminate_session(
    session_id: str,
    svc: DevinService = Depends(get_devin_service),
) -> dict[str, Any]:
    try:
        return await svc.terminate_session(session_id)
    except DevinAPIError as e:
        _raise(e)


# ─── SSE log stream ───────────────────────────────────────────────────────


def _sse_pack(event_type: str, payload: dict[str, Any]) -> str:
    """Format one Server-Sent Events frame. ``\\n\\n`` terminates the message."""
    return f"event: {event_type}\ndata: {json.dumps(payload, default=str)}\n\n"


@router.get("/sessions/{session_id}/stream")
async def stream_session(
    session_id: str,
    poller: DevinPoller = Depends(get_devin_poller),
) -> StreamingResponse:
    """Server-Sent Events stream of session updates.

    Frame types pushed to the client:

      * ``snapshot``    — current state at subscribe time (always first)
      * ``messages``    — array of new message objects appended to ``messages``
      * ``status``      — ``{from, to}`` ``status_enum`` transition
      * ``structured``  — typed ``structured_output`` populated / changed
      * ``done``        — terminal status reached (stream auto-closes after this)
      * ``error``       — transient upstream error (stream stays open)
      * ``ping``        — heartbeat every ~15s so proxies don't kill the connection

    The frontend can do ``new EventSource('/api/devin/sessions/<id>/stream')``
    and listen for whichever frame types it cares about.
    """

    async def gen():
        # Initial heartbeat so the EventSource opens immediately even if the
        # poller takes a moment to deliver the snapshot.
        yield ": connected\n\n"
        try:
            async for event in poller.subscribe(session_id):
                yield _sse_pack(event.type, event.to_dict())
                if event.type == "done":
                    return
        except Exception:  # noqa: BLE001
            logger.exception("SSE stream for %s aborted", session_id)
            yield _sse_pack("error", {"detail": "stream aborted"})

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # disable buffering on nginx-style proxies
    }
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


# ─── Attachments ──────────────────────────────────────────────────────────


@router.post("/attachments")
async def upload_attachment(
    file: UploadFile,
    svc: DevinService = Depends(get_devin_service),
) -> dict[str, Any]:
    """Upload a file and return its URL + the ``ATTACHMENT:"<url>"`` line.

    Devin only recognises attachments referenced via that exact format on a
    line by itself in the prompt — see the
    [Devin attachment docs](https://docs.devin.ai/api-reference/v1/attachments/upload-files-for-devin-to-work-with).
    """
    if file.filename is None:
        raise HTTPException(status_code=400, detail="filename is required")
    try:
        url = await svc.upload_attachment(
            file=file.file,
            filename=file.filename,
            content_type=file.content_type,
        )
    except DevinAPIError as e:
        _raise(e)
    return {
        "url": url,
        "filename": file.filename,
        "attachment_line": svc.attachment_ref(url),
    }


# ─── Health ───────────────────────────────────────────────────────────────


@router.get("/health")
async def health(svc: DevinService = Depends(get_devin_service)) -> dict[str, Any]:
    """Reachability + auth check for the Devin upstream."""
    try:
        rows = await svc.list_sessions(limit=1)
        return {"ok": True, "reachable": True, "sample_count": len(rows)}
    except DevinAPIError as e:
        return {"ok": False, "status": e.status, "detail": e.detail}
