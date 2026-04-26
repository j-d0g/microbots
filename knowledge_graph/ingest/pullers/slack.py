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


_MAX_TEXT_CHARS = 4000  # ~1k tokens; truncate long messages for triage
_MAX_REACTIONS = 5  # keep top-N reactions only


def _unwrap(d: Any) -> Any:
    """execute_tool already unwraps top-level `data`, but some Composio responses
    nest a second `data` wrapper. Mirror Gmail puller's defensive unwrap."""
    if isinstance(d, dict) and isinstance(d.get("data"), (dict, list)):
        return d["data"]
    return d


def _extract_list(d: Any, *keys: str) -> list[dict[str, Any]]:
    """Pull a list out of a Composio response, trying multiple key names."""
    payload = _unwrap(d)
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for k in keys:
            v = payload.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
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


def _slim_message(m: dict[str, Any], channel_id: str, channel_name: str | None) -> dict[str, Any]:
    """Strip raw Slack message to triage-relevant fields only.

    Drops block kit JSON, raw blocks/attachments, edited metadata, subscription
    flags, team IDs, and other noise. Keeps text (truncated), sender, channel,
    thread, timestamp, and a small reaction summary.
    """
    if not isinstance(m, dict):
        return {"placeholder": True}
    text = m.get("text") or ""
    if len(text) > _MAX_TEXT_CHARS:
        text = text[:_MAX_TEXT_CHARS] + f"\n…[truncated {len(text) - _MAX_TEXT_CHARS} chars]"

    # Reactions: keep only name + count, top N by count.
    reactions_raw = m.get("reactions") or []
    reactions: list[dict[str, Any]] = []
    if isinstance(reactions_raw, list):
        sorted_r = sorted(
            (r for r in reactions_raw if isinstance(r, dict)),
            key=lambda r: r.get("count", 0),
            reverse=True,
        )
        for r in sorted_r[:_MAX_REACTIONS]:
            reactions.append({"name": r.get("name"), "count": r.get("count", 0)})

    # File summaries (drop binary URLs, permissions, previews)
    files_raw = m.get("files") or []
    files: list[dict[str, Any]] = []
    if isinstance(files_raw, list):
        for f in files_raw[:5]:
            if isinstance(f, dict):
                files.append({
                    "name": f.get("name"),
                    "mimetype": f.get("mimetype"),
                    "title": f.get("title"),
                })

    return {
        "ts": m.get("ts"),
        "thread_ts": m.get("thread_ts"),
        "user": m.get("user") or m.get("bot_id"),
        "channel_id": channel_id,
        "channel": channel_name,
        "type": m.get("type"),
        "subtype": m.get("subtype"),
        "text": text,
        "reply_count": m.get("reply_count", 0),
        "reactions": reactions,
        "files": files,
    }


def _slim_user(u: dict[str, Any]) -> dict[str, Any]:
    """Strip raw Slack user to identity-relevant fields only."""
    if not isinstance(u, dict):
        return {"placeholder": True}
    profile = u.get("profile") or {}
    if not isinstance(profile, dict):
        profile = {}
    return {
        "id": u.get("id"),
        "name": u.get("name"),
        "real_name": u.get("real_name") or profile.get("real_name"),
        "display_name": profile.get("display_name"),
        "email": profile.get("email"),
        "title": profile.get("title"),
        "is_bot": u.get("is_bot", False),
        "is_admin": u.get("is_admin", False),
        "deleted": u.get("deleted", False),
        "tz": u.get("tz"),
    }


class SlackPuller(BasePuller):
    name = "slack"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        user = config.composio_user_id
        items: list[RawItem] = []

        # --- channels ---
        channels: list[dict[str, Any]] = []
        for slug in (
            "SLACK_LIST_ALL_CHANNELS",
            "SLACK_LIST_CONVERSATIONS",
            "SLACK_FIND_CHANNELS",
        ):
            d = execute_tool(
                composio,
                slug,
                {"types": "public_channel,private_channel,mpim,im"},
                user,
            )
            channels = _extract_list(d, "channels", "conversations")
            if channels:
                break
        if not channels:
            log.error("Slack: could not list channels; check Composio Slack tools.")
            return []

        # --- per-channel history ---
        for ch in channels[:30]:
            cid = ch.get("id", "")
            cname = ch.get("name")
            if not cid:
                continue
            hist: Any = None
            for hslug in (
                "SLACK_FETCH_CONVERSATION_HISTORY",
                "SLACK_RETRIEVE_A_CONVERSATIONS_HISTORY",
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
            msg_list = _extract_list(hist, "messages")
            for m in msg_list:
                ts = m.get("ts", "")
                eid = (
                    f"slack:{cid}:{ts}"
                    if ts
                    else f"slack:{cid}:{m.get('client_msg_id', 'noid')}"
                )
                slim = _slim_message(m, cid, cname)
                items.append(
                    RawItem(
                        external_id=eid,
                        source_type="slack_message",
                        integration="slack",
                        content=slim,
                        occurred_at=_slack_ts_to_dt(ts or None),
                        metadata={"channel_id": cid, "channel": cname},
                    )
                )

        # --- users ---
        d_users: Any = None
        for uslug in (
            "SLACK_LIST_ALL_USERS",
            "SLACK_FIND_USERS",
        ):
            d_users = execute_tool(composio, uslug, {"limit": 200}, user)
            if d_users is not None:
                break
        ulist = _extract_list(d_users, "members", "users")
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
                    content=_slim_user(u),
                    occurred_at=utcnow(),
                    metadata={"type": "user"},
                )
            )
        log.info("Slack pull: %d raw items (slim)", len(items))
        return items
