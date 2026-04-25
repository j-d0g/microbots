"""Notion: search + page fetch (Composio tool slugs per toolkit docs)."""
from __future__ import annotations

import logging
from typing import Any

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem, utcnow
from ingest.pullers.execute import execute_tool

log = logging.getLogger(__name__)


def _as_search_results(d: Any) -> list[dict[str, Any]]:
    if d is None:
        return []
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if not isinstance(d, dict):
        return []
    for k in ("results", "data", "pages", "items"):
        v = d.get(k)
        if isinstance(v, list):
            return [x for x in v if isinstance(x, dict)]
    return []


def _search(
    composio: Composio, user_id: str, _config: Config
) -> list[dict[str, Any]]:
    d = execute_tool(
        composio,
        "NOTION_SEARCH_NOTION_PAGE",
        {
            "query": "",
            "page_size": 20,
        },
        user_id,
    )
    return _as_search_results(d)


def _get_page(
    composio: Composio, user_id: str, page_id: str
) -> dict[str, Any] | None:
    for slug in ("NOTION_RETRIEVE_PAGE",):
        d = execute_tool(
            composio, slug, {"page_id": page_id}, user_id
        )
        if isinstance(d, dict):
            return d
    return None


class NotionPuller(BasePuller):
    name = "notion"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        user = config.composio_user_id
        res = _search(composio, user, config)
        want = set((config.scopes.notion_databases or []) or [])
        out: list[RawItem] = []
        for p in res[:20]:
            pid = p.get("id", "")
            if not pid:
                continue
            if want and pid not in want:
                t = p.get("type", "")
                pobj = p.get("object", p.get("name", ""))
                if str(t) and str(t) not in (str(x) for x in want):
                    if str(pobj) and str(pobj) not in (str(x) for x in want):
                        pass
            det = _get_page(composio, user, pid) or p
            ext = f"notion:{pid}:page"
            out.append(
                RawItem(
                    external_id=ext,
                    source_type="notion_page",
                    integration="notion",
                    content=det if isinstance(det, dict) else p,
                    occurred_at=utcnow(),
                    metadata={"notion_id": pid},
                )
            )
        log.info("Notion pull: %d items", len(out))
        return out
