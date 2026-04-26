"""Gmail: list and fetch within backfill window."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem, utcnow
from ingest.pullers.execute import execute_tool

log = logging.getLogger(__name__)


def _q_after(config: Config) -> str:
    dt = utcnow() - timedelta(weeks=config.backfill.backfill_weeks)
    d = dt.strftime("%Y/%m/%d")
    return f"after:{d}"


def _list_msg_ids(
    composio: Composio, user_id: str, config: Config
) -> list[str]:
    q = f"{_q_after(config)}"
    for lb in (config.scopes.gmail_labels or ["INBOX"]):
        for slug in ("GMAIL_FETCH_EMAILS", "GMAIL_GET_EMAILS"):
            d = execute_tool(
                composio,
                slug,
                {
                    "query": q,
                    "labelIds": [lb] if isinstance(lb, str) else lb,
                    "maxResults": 40,
                },
                user_id,
            )
            if d is None:
                continue
            payload = d.get("data", d) if isinstance(d, dict) else None
            ids: list[str] = []
            if isinstance(payload, dict) and payload.get("messages"):
                for m in payload["messages"]:
                    if isinstance(m, dict):
                        mid = m.get("id") or m.get("messageId")
                        if mid:
                            ids.append(mid)
            if ids:
                return ids
    return []


def _get_msg(composio: Composio, user_id: str, mid: str) -> dict[str, Any] | None:
    for slug in ("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_GET_EMAIL", "GMAIL_FETCH_A_EMAIL", "GMAIL_RETRIEVE_A_EMAIL"):
        d = execute_tool(
            composio, slug, {"message_id": mid, "messageId": mid, "id": mid, "format": "full"}, user_id
        )
        if d is None:
            continue
        if isinstance(d, dict):
            return d.get("data", d) if isinstance(d.get("data"), dict) else d
    return None


_KEEP_HEADERS = {"From", "To", "Cc", "Subject", "Date", "Reply-To"}
_MAX_BODY_CHARS = 4000  # ~1k tokens; truncate long emails for triage


def _slim_email(body: dict[str, Any], mid: str) -> dict[str, Any]:
    """Strip raw Gmail payload to triage-relevant fields only.

    Drops base64-encoded body data, MIME parts, attachments, and 30+ noise
    headers. Keeps decoded messageText (truncated) plus a handful of headers.
    """
    if not isinstance(body, dict):
        return {"id": mid, "placeholder": True}
    payload = body.get("payload") or {}
    headers = {
        h.get("name"): h.get("value")
        for h in (payload.get("headers") or [])
        if isinstance(h, dict) and h.get("name") in _KEEP_HEADERS
    }
    text = body.get("messageText") or ""
    if len(text) > _MAX_BODY_CHARS:
        text = text[:_MAX_BODY_CHARS] + f"\n…[truncated {len(text) - _MAX_BODY_CHARS} chars]"
    return {
        "id": body.get("messageId") or mid,
        "thread_id": body.get("threadId"),
        "labels": body.get("labelIds") or [],
        "snippet": body.get("snippet") or body.get("preview") or "",
        "headers": headers,
        "text": text,
    }


class GmailPuller(BasePuller):
    name = "gmail"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        user = config.composio_user_id
        ids = _list_msg_ids(composio, user, config)[:30]
        out: list[RawItem] = []
        for mid in ids:
            body = _get_msg(composio, user, mid)
            slim = _slim_email(body, mid) if body else {"id": mid, "placeholder": True}
            ext = f"gmail:{mid}"
            out.append(
                RawItem(
                    external_id=ext,
                    source_type="gmail_email",
                    integration="gmail",
                    content=slim,
                    occurred_at=utcnow(),
                    metadata={"message_id": mid},
                )
            )
        log.info("Gmail pull: %d items (slim)", len(out))
        return out
