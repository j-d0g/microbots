"""GitHub: deterministic Composio pulls (repos, PRs, issues)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem, utcnow
from ingest.pullers.execute import execute_tool

log = logging.getLogger(__name__)

_MAX_BODY_CHARS = 4000  # ~1k tokens; truncate long PR/issue bodies for triage


def _parse_time(v: Any) -> datetime:
    if v is None:
        return utcnow()
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(float(v) / 1000.0, tz=timezone.utc)
    s = str(v)
    if s.isdigit() and len(s) > 10:
        return datetime.fromtimestamp(int(s) / 1000.0, tz=timezone.utc)
    try:
        return parsedate_to_datetime(s.replace("Z", "+00:00"))
    except Exception:
        return utcnow()


def _unwrap(d: Any) -> Any:
    """Unwrap Composio's `{"data": ...}` envelope when present."""
    if isinstance(d, dict) and "data" in d and isinstance(d["data"], (dict, list)):
        return d["data"]
    return d


def _first_list(d: Any, keys: tuple[str, ...]) -> list[dict[str, Any]]:
    """Return the first list found under any of the given keys, or [] if none."""
    if isinstance(d, list):
        return d
    if not isinstance(d, dict):
        return []
    for k in keys:
        v = d.get(k)
        if isinstance(v, list):
            return v
    return []


def _user_login(u: Any) -> str:
    """GitHub user fields can be dicts, strings, or stringified dicts."""
    if isinstance(u, dict):
        return str(u.get("login") or u.get("name") or "")
    if isinstance(u, str):
        return u
    return ""


def _repos_list(
    composio: Composio, user_id: str
) -> list[dict[str, Any]]:
    # GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER is the canonical
    # slug; FIND_REPOSITORIES is a search-style fallback that requires a
    # non-empty query.
    for slug, args in (
        (
            "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
            {"per_page": 30, "page": 1},
        ),
        (
            "GITHUB_FIND_REPOSITORIES",
            {
                "query": "stars:>=0",
                "for_authenticated_user": True,
                "per_page": 30,
                "page": 1,
            },
        ),
    ):
        d = execute_tool(composio, slug, args, user_id)
        if d is None:
            continue
        payload = _unwrap(d)
        repos = _first_list(payload, ("repositories", "items", "results"))
        if repos:
            return repos
        log.debug("repo list: slug %s returned no items", slug)
    log.error("No GitHub repo list Composio tool worked; check connected account.")
    return []


def _filter_repos(
    all_repos: list[dict[str, Any]], want: list[str]
) -> list[dict[str, Any]]:
    if not want:
        return all_repos
    out: list[dict[str, Any]] = []
    wset = {w.strip().lower() for w in want if w}
    for r in all_repos:
        full = (r.get("full_name") or "").lower()
        name = (r.get("name") or "").lower()
        login = _user_login(r.get("owner")).lower()
        composed = f"{login}/{name}" if login and name else full
        for w in wset:
            if w in (full, name, composed, composed.split("/")[-1]):
                out.append(r)
                break
    return out or all_repos


def _list_prs(
    owner: str,
    repo: str,
    composio: Composio,
    user_id: str,
) -> list[dict[str, Any]]:
    # GITHUB_LIST_PULL_REQUESTS is the live slug; GITHUB_FIND_PULL_REQUESTS is
    # the AI-search fallback (response shape: pull_requests[]).
    base = {"owner": owner, "repo": repo, "state": "all", "per_page": 20}
    for slug, args in (
        ("GITHUB_LIST_PULL_REQUESTS", base),
        (
            "GITHUB_FIND_PULL_REQUESTS",
            {**base, "sort": "updated", "order": "desc"},
        ),
    ):
        d = execute_tool(composio, slug, args, user_id)
        if d is None:
            continue
        payload = _unwrap(d)
        prs = _first_list(
            payload, ("pull_requests", "pulls", "items", "results")
        )
        if prs:
            return prs
    return []


def _list_issues(
    owner: str,
    repo: str,
    composio: Composio,
    user_id: str,
) -> list[dict[str, Any]]:
    # The legacy GITHUB_LIST_ISSUES slug 404s; GITHUB_LIST_REPOSITORY_ISSUES
    # is the live slug (response shape: issues[]).
    base = {"owner": owner, "repo": repo, "state": "all", "per_page": 20}
    for slug in ("GITHUB_LIST_REPOSITORY_ISSUES",):
        d = execute_tool(composio, slug, base, user_id)
        if d is None:
            continue
        payload = _unwrap(d)
        issues = _first_list(payload, ("issues", "items", "results"))
        if issues:
            return issues
    return []


def _truncate(text: str | None) -> str:
    if not text:
        return ""
    s = str(text)
    if len(s) <= _MAX_BODY_CHARS:
        return s
    return s[:_MAX_BODY_CHARS] + f"\n…[truncated {len(s) - _MAX_BODY_CHARS} chars]"


def _slim_pr(owner: str, repo: str, p: dict[str, Any]) -> dict[str, Any]:
    """Strip a PR payload to triage-relevant fields.

    Drops diffs, large head/base commit blobs, review payloads, and noisy
    URL fields. Keeps identity, state, timestamps, author, and a truncated
    body.
    """
    head = p.get("head") or {}
    base = p.get("base") or {}
    return {
        "type": "pull_request",
        "id": p.get("id") or p.get("node_id"),
        "number": p.get("number"),
        "repo": f"{owner}/{repo}",
        "title": p.get("title") or "",
        "state": p.get("state"),
        "draft": p.get("draft"),
        "merged": p.get("merged") or bool(p.get("merged_at")),
        "author": _user_login(p.get("user")),
        "assignees": [_user_login(a) for a in (p.get("assignees") or []) if a],
        "labels": [
            (l.get("name") if isinstance(l, dict) else str(l))
            for l in (p.get("labels") or [])
        ],
        "head_ref": head.get("ref") if isinstance(head, dict) else None,
        "base_ref": base.get("ref") if isinstance(base, dict) else None,
        "created_at": p.get("created_at"),
        "updated_at": p.get("updated_at"),
        "closed_at": p.get("closed_at"),
        "merged_at": p.get("merged_at"),
        "html_url": p.get("html_url"),
        "body": _truncate(p.get("body")),
    }


def _slim_issue(owner: str, repo: str, i: dict[str, Any]) -> dict[str, Any]:
    """Strip an issue payload to triage-relevant fields."""
    return {
        "type": "issue",
        "id": i.get("id") or i.get("node_id"),
        "number": i.get("number"),
        "repo": f"{owner}/{repo}",
        "title": i.get("title") or "",
        "state": i.get("state"),
        "state_reason": i.get("state_reason"),
        "author": _user_login(i.get("user")),
        "assignees": [_user_login(a) for a in (i.get("assignees") or []) if a],
        "labels": [
            (l.get("name") if isinstance(l, dict) else str(l))
            for l in (i.get("labels") or [])
        ],
        "comments": i.get("comments"),
        "created_at": i.get("created_at"),
        "updated_at": i.get("updated_at"),
        "closed_at": i.get("closed_at"),
        "html_url": i.get("html_url"),
        "body": _truncate(i.get("body")),
    }


def _pr_to_raw(owner: str, repo: str, p: dict[str, Any]) -> RawItem:
    n = p.get("number", 0)
    ext = f"github:{owner}/{repo}:pr:{n}"
    t = (
        p.get("merged_at")
        or p.get("closed_at")
        or p.get("updated_at")
        or p.get("created_at")
    )
    return RawItem(
        external_id=ext,
        source_type="github_pr",
        integration="github",
        content=_slim_pr(owner, repo, p),
        occurred_at=_parse_time(t) if t else utcnow(),
        metadata={"owner": owner, "repo": repo, "type": "pull_request"},
    )


def _issue_to_raw(owner: str, repo: str, i: dict[str, Any]) -> RawItem | None:
    n = i.get("number", 0)
    if i.get("pull_request"):
        return None
    ext = f"github:{owner}/{repo}:issue:{n}"
    t = i.get("closed_at") or i.get("updated_at") or i.get("created_at")
    return RawItem(
        external_id=ext,
        source_type="github_issue",
        integration="github",
        content=_slim_issue(owner, repo, i),
        occurred_at=_parse_time(t) if t else utcnow(),
        metadata={"owner": owner, "repo": repo, "type": "issue"},
    )


class GitHubPuller(BasePuller):
    name = "github"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:
        uid = config.composio_user_id
        repos = _filter_repos(
            _repos_list(composio, uid), config.scopes.github_repos
        )
        items: list[RawItem] = []
        for r in repos:
            owner = _user_login(r.get("owner"))
            name = r.get("name", "")
            if not owner or not name:
                if r.get("full_name") and "/" in r["full_name"]:
                    a, b = r["full_name"].split("/", 1)
                    owner, name = a, b
                else:
                    continue
            for p in _list_prs(owner, name, composio, uid):
                items.append(_pr_to_raw(owner, name, p))
            for i in _list_issues(owner, name, composio, uid):
                raw = _issue_to_raw(owner, name, i)
                if raw is not None:
                    items.append(raw)
        log.info(
            "GitHub pull: %d raw items (slim) from %d repos",
            len(items),
            len(repos),
        )
        return items
