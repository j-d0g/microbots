"""Perplexity: async Sonar chat jobs (list + optional detail) within backfill window."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem, utcnow
from ingest.pullers.execute import execute_tool

log = logging.getLogger(__name__)

_MAX_LIST_PAGES = 20


def _cutoff(config: Config) -> datetime:
    return utcnow() - timedelta(weeks=config.backfill.backfill_weeks)


def _ts_to_dt(ts: int | float | str | None) -> datetime | None:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _extract_requests(d: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not d or not isinstance(d, dict):
        return []
    raw = d.get("requests")
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    inner = d.get("data")
    if isinstance(inner, dict) and isinstance(inner.get("requests"), list):
        return [x for x in inner["requests"] if isinstance(x, dict)]
    return []


def _next_page_token(d: dict[str, Any] | None) -> str | None:
    if not d or not isinstance(d, dict):
        return None
    for k in ("next_token", "nextToken", "cursor"):
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v
    inner = d.get("data")
    if isinstance(inner, dict):
        for k in ("next_token", "nextToken", "cursor"):
            v = inner.get(k)
            if isinstance(v, str) and v.strip():
                return v
    return None


def _list_all_pages(
    composio: Composio, user_id: str
) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    token: str | None = None
    for _ in range(_MAX_LIST_PAGES):
        args: dict[str, Any] = {}
        if token:
            args["next_token"] = token
        d = execute_tool(
            composio, "PERPLEXITYAI_LIST_ASYNC_CHAT_COMPLETIONS", args, user_id
        )
        if not d:
            break
        if not isinstance(d, dict):
            break
        batch = _extract_requests(d)
        if not batch:
            err = d.get("message") or d.get("error")
            if err:
                log.warning("Perplexity list: %s", err)
            token = _next_page_token(d)
            if not token:
                break
            continue
        all_rows.extend(batch)
        token = _next_page_token(d)
        if not token:
            break
    return all_rows


def _request_id(row: dict[str, Any]) -> str:
    for k in ("id", "request_id", "requestId"):
        v = row.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def _get_async_detail(
    composio: Composio, user_id: str, rid: str
) -> dict[str, Any] | None:
    for slug in (
        "PERPLEXITYAI_GET_ASYNC_CHAT_COMPLETION",
        "PERPLEXITYAI_RETRIEVE_ASYNC_CHAT_COMPLETION",
    ):
        for args in ({"id": rid}, {"request_id": rid}):
            d = execute_tool(composio, slug, args, user_id)
            if d and isinstance(d, dict) and d:
                return d
    return None


class PerplexityPuller(BasePuller):
    name = "perplexity"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        user = config.composio_user_id
        window_start = _cutoff(config)
        rows = _list_all_pages(composio, user)
        if not rows:
            log.warning(
                "Perplexity: no async jobs from list API; check Composio / "
                "perplexityai link and tool PERPLEXITYAI_LIST_ASYNC_CHAT_COMPLETIONS."
            )
            return []

        out: list[RawItem] = []
        for row in rows:
            rid = _request_id(row)
            if not rid:
                continue
            created = (
                _ts_to_dt(row.get("created_at"))
                or _ts_to_dt(row.get("started_at"))
                or _ts_to_dt(row.get("completed_at"))
            )
            if created is not None and created < window_start:
                continue
            if created is None:
                log.debug("Perplexity: skipping job without parseable time: %r", row)
                continue

            detail = _get_async_detail(composio, user, rid)
            body: dict[str, Any] = {
                "summary": row,
            }
            if detail:
                body["detail"] = detail

            occurred = created or utcnow()
            out.append(
                RawItem(
                    external_id=f"perplexity:async:{rid}",
                    source_type="perplexity_async_chat",
                    integration="perplexity",
                    content=body,
                    occurred_at=occurred,
                    metadata={
                        "model": row.get("model", ""),
                        "status": str(row.get("status", "")),
                    },
                )
            )

        log.info("Perplexity pull: %d item(s) in backfill window", len(out))
        return out
