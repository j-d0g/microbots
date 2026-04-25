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
        for slug in ("GMAIL_FETCH_EMAILS", "GMAIL_LIST_EMAILS", "GMAIL_GET_EMAILS"):
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
            ids: list[str] = []
            if isinstance(d, dict) and d.get("messages"):
                for m in d["messages"]:
                    if isinstance(m, dict) and m.get("id"):
                        ids.append(m["id"])
            if ids:
                return ids
    return []


def _get_msg(composio: Composio, user_id: str, mid: str) -> dict[str, Any] | None:
    for slug in ("GMAIL_GET_EMAIL", "GMAIL_FETCH_A_EMAIL", "GMAIL_RETRIEVE_A_EMAIL"):
        d = execute_tool(
            composio, slug, {"id": mid, "format": "full"}, user_id
        )
        if d is not None:
            return d if isinstance(d, dict) else None
    return None


class GmailPuller(BasePuller):
    name = "gmail"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        user = config.composio_user_id
        ids = _list_msg_ids(composio, user, config)[:30]
        out: list[RawItem] = []
        for mid in ids:
            body = _get_msg(composio, user, mid)
            if not body:
                body = {"id": mid, "placeholder": True}
            ext = f"gmail:{mid}"
            out.append(
                RawItem(
                    external_id=ext,
                    source_type="gmail_email",
                    integration="gmail",
                    content=body,
                    occurred_at=utcnow(),
                    metadata={"message_id": mid},
                )
            )
        log.info("Gmail pull: %d items", len(out))
        return out
