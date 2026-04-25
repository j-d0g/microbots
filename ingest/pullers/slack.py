"""Slack: channels, messages, users (best-effort Composio slugs)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem, utcnow
from ingest.pullers.execute import execute_tool

log = logging.getLogger(__name__)


def _as_dict_list(d: Any) -> list[dict[str, Any]]:
    if d is None:
        return []
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if isinstance(d, dict):
        for k in (
            "channels",
            "data",
            "conversations",
            "messages",
            "members",
            "users",
            "ok",
        ):
            if k in d and isinstance(d[k], list):
                return [x for x in d[k] if isinstance(x, dict)]
    return []


def _slack_ts_to_dt(ts: str | float | None) -> datetime:
    if ts is None:
        return utcnow()
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc)
    except (TypeError, ValueError):
        return utcnow()


def _oldest_backfill_str(config: Config) -> str:
    dt = utcnow() - timedelta(weeks=config.backfill.backfill_weeks)
    return str(int(dt.timestamp()))


class SlackPuller(BasePuller):
    name = "slack"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        user = config.composio_user_id
        items: list[RawItem] = []
        for slug in (
            "SLACK_LIST_ALL_CHANNELS",
            "SLACK_LIST_CHANNELS",
            "SLACK_GET_CHANNELS_LIST",
        ):
            d = execute_tool(
                composio, slug, {"types": "public_channel,private_channel,mpim,im"},
                user,
            )
            channels = _as_dict_list(d)
            if not channels and isinstance(d, dict) and d.get("channels"):
                channels = [x for x in d["channels"] if isinstance(x, dict)]
            if channels:
                break
        if not channels:
            log.error("Slack: could not list channels; check Composio Slack tools.")
            return []

        for ch in channels[:30]:
            cid = ch.get("id", "")
            if not cid:
                continue
            hist: Any = None
            for hslug in (
                "SLACK_FETCH_CONVERSATION_HISTORY",
                "SLACK_RETRIEVE_A_CONVERSATIONS_HISTORY",
                "SLACK_GET_CHANNEL_HISTORY",
            ):
                hist = execute_tool(
                    composio,
                    hslug,
                    {
                        "channel": cid,
                        "oldest": _oldest_backfill_str(config),
                        "limit": 30,
                    },
                    user,
                )
                if hist is not None:
                    break
            msg_list: list[dict[str, Any]] = []
            if isinstance(hist, dict):
                msg_list = [m for m in (hist.get("messages") or []) if isinstance(m, dict)]
            elif isinstance(hist, list):
                msg_list = [m for m in hist if isinstance(m, dict)]
            for m in msg_list:
                ts = m.get("ts", "")
                eid = f"slack:{cid}:{ts}" if ts else f"slack:{cid}:{m.get('client_msg_id', 'noid')}"
                items.append(
                    RawItem(
                        external_id=eid,
                        source_type="slack_message",
                        integration="slack",
                        content=m,
                        occurred_at=_slack_ts_to_dt(
                            m.get("ts", ts) if m.get("ts") else None
                        ),
                        metadata={"channel_id": cid, "channel": ch.get("name")},
                    )
                )

        d_users = None
        for uslug in ("SLACK_LIST_ALL_USERS", "SLACK_GET_USERS", "SLACK_RETRIEVE_A_USERS_INFO"):
            d_users = execute_tool(
                composio, uslug, {"limit": 200}, user
            )
            if d_users is not None:
                break
        ulist: list[dict[str, Any]] = []
        if isinstance(d_users, list):
            ulist = d_users
        elif isinstance(d_users, dict):
            ulist = [u for u in (d_users.get("members") or d_users.get("data") or []) if isinstance(u, dict)]
        for u in ulist[:200]:
            uid_ = u.get("id", "")
            if not uid_:
                continue
            eid = f"slack_user:{uid_}"
            items.append(
                RawItem(
                    external_id=eid,
                    source_type="slack_user_profile",
                    integration="slack",
                    content=u,
                    occurred_at=utcnow(),
                    metadata={"type": "user"},
                )
            )
        log.info("Slack pull: %d raw items", len(items))
        return items
