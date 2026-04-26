"""Linear: issues and comments (Composio tool slugs per toolkit docs)."""
from __future__ import annotations

import logging
from typing import Any

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem, utcnow
from ingest.pullers.execute import execute_tool

log = logging.getLogger(__name__)


def _unwrap(d: Any) -> Any:
    """Unwrap an outer ``{"data": ...}`` envelope if execute_tool returned one."""
    if isinstance(d, dict) and isinstance(d.get("data"), (dict, list)):
        return d["data"]
    return d


def _as_project_list(d: Any) -> list[dict[str, Any]]:
    d = _unwrap(d)
    if d is None:
        return []
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if not isinstance(d, dict):
        return []
    for k in ("projects", "nodes", "data", "items"):
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
    d = _unwrap(d)
    if d is None:
        return []
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if not isinstance(d, dict):
        return []
    for k in ("issues", "nodes", "data", "items"):
        v = d.get(k)
        if isinstance(v, list):
            return [x for x in v if isinstance(x, dict)]
    return []


_MAX_DESC_CHARS = 4000  # ~1k tokens; truncate long Linear descriptions for triage


def _name_of(v: Any) -> str | None:
    """Extract a display name from a possibly-nested Linear field."""
    if isinstance(v, dict):
        return v.get("name") or v.get("displayName") or v.get("email") or v.get("id")
    if isinstance(v, str):
        return v
    return None


def _slim_issue(it: dict[str, Any]) -> dict[str, Any]:
    """Strip Linear issue payload to triage-relevant fields only.

    Drops long descriptions (truncated), comment threads, raw label nodes,
    URLs, and other noise. Keeps id, identifier (e.g. ENG-123), title,
    state, assignee, priority, project, short description excerpt,
    and last_updated.
    """
    if not isinstance(it, dict):
        return {"placeholder": True}
    desc = it.get("description") or ""
    if isinstance(desc, str) and len(desc) > _MAX_DESC_CHARS:
        desc = desc[:_MAX_DESC_CHARS] + f"\n…[truncated {len(desc) - _MAX_DESC_CHARS} chars]"
    labels_raw = it.get("labels")
    labels: list[str] = []
    if isinstance(labels_raw, dict):
        for n in labels_raw.get("nodes", []) or []:
            name = _name_of(n)
            if name:
                labels.append(name)
    elif isinstance(labels_raw, list):
        for n in labels_raw:
            name = _name_of(n)
            if name:
                labels.append(name)
    return {
        "id": it.get("id"),
        "identifier": it.get("identifier"),
        "title": it.get("title") or it.get("name"),
        "state": _name_of(it.get("state")),
        "assignee": _name_of(it.get("assignee")),
        "priority": it.get("priority"),
        "project": _name_of(it.get("project")),
        "team": _name_of(it.get("team")),
        "labels": labels,
        "description": desc,
        "url": it.get("url"),
        "last_updated": it.get("updatedAt") or it.get("updated_at"),
    }


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
                slim = _slim_issue(it)
                out.append(
                    RawItem(
                        external_id=ext,
                        source_type="linear_issue",
                        integration="linear",
                        content=slim,
                        occurred_at=utcnow(),
                        metadata={"project": slug, "project_id": pid},
                    )
                )
        log.info("Linear pull: %d items (slim)", len(out))
        return out
