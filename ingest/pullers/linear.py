"""Linear: issues and comments (Composio tool slugs per toolkit docs)."""
from __future__ import annotations

import logging
from typing import Any

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem, utcnow
from ingest.pullers.execute import execute_tool

log = logging.getLogger(__name__)


def _as_project_list(d: Any) -> list[dict[str, Any]]:
    if d is None:
        return []
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if not isinstance(d, dict):
        return []
    for k in ("projects", "data", "nodes"):
        v = d.get(k)
        if isinstance(v, list):
            return [x for x in v if isinstance(x, dict)]
    return []


def _list_projects(composio: Composio, user_id: str) -> list[dict[str, Any]]:
    d = execute_tool(
        composio,
        "LINEAR_LIST_LINEAR_PROJECTS",
        {"first": 50},
        user_id,
    )
    return _as_project_list(d)


def _as_issue_list(d: Any) -> list[dict[str, Any]]:
    if d is None:
        return []
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if not isinstance(d, dict):
        return []
    for k in ("issues", "data", "nodes"):
        v = d.get(k)
        if isinstance(v, list):
            return [x for x in v if isinstance(x, dict)]
    return []


def _list_issues(
    project_id: str, composio: Composio, user_id: str
) -> list[dict[str, Any]]:
    d = execute_tool(
        composio,
        "LINEAR_LIST_LINEAR_ISSUES",
        {"project_id": project_id, "first": 50},
        user_id,
    )
    return _as_issue_list(d)


class LinearPuller(BasePuller):
    name = "linear"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        user = config.composio_user_id
        projs = _list_projects(composio, user)
        want = {p.lower() for p in (config.scopes.linear_projects or []) if p}
        if want and projs:
            projs = [
                p
                for p in projs
                if (p.get("name") or p.get("slug") or "").lower() in want
            ] or projs
        out: list[RawItem] = []
        for p in projs[:20]:
            pid = p.get("id", "")
            slug = (p.get("name") or p.get("slug") or "project")[:50]
            if not pid:
                continue
            for it in _list_issues(pid, composio, user):
                iid = it.get("id", "")
                if not iid:
                    continue
                ext = f"linear:{slug}:{iid}"
                out.append(
                    RawItem(
                        external_id=ext,
                        source_type="linear_issue",
                        integration="linear",
                        content=it,
                        occurred_at=utcnow(),
                        metadata={"project": slug, "project_id": pid},
                    )
                )
        log.info("Linear pull: %d items", len(out))
        return out
