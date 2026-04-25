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


def _repos_list(
    composio: Composio, user_id: str
) -> list[dict[str, Any]]:
    for slug in (
        "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
        "GITHUB_REPOS_LIST_FOR_THE_AUTHENTICATED_USER",
        "GITHUB_LIST_REPOS_FOR_THE_AUTHENTICATED_USER",
        "GITHUB_REPOS_LIST_FOR_AUTHENTICATED_USER",
    ):
        d = execute_tool(
            composio, slug, {"per_page": 30, "page": 1}, user_id
        )
        if d is not None:
            if isinstance(d, list):
                return d
            if isinstance(d, dict) and "repositories" in d:
                v = d["repositories"] or []
                if isinstance(v, list):
                    return v
            if isinstance(d, dict) and "data" in d and isinstance(d["data"], list):
                return d["data"]
        log.debug("repo list: trying next slug, %s empty", slug)
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
        o = r.get("owner", {})
        login = (o.get("login", o) if isinstance(o, dict) else o) or ""
        if isinstance(login, str):
            composed = f"{login}/{name}"
        else:
            composed = full
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
    args: dict[str, Any] = {
        "owner": owner,
        "repo": repo,
        "state": "all",
        "per_page": 20,
    }
    for s in (
        "GITHUB_LIST_PULL_REQUESTS",
        "GITHUB_PULLS_LIST",
    ):
        d = execute_tool(composio, s, args, user_id)
        if d is None:
            continue
        if isinstance(d, list):
            return d
        if isinstance(d, dict):
            for k in ("data", "pulls", "pull_requests", "items"):
                v = d.get(k)
                if isinstance(v, list):
                    return v
    return []


def _list_issues(
    owner: str,
    repo: str,
    composio: Composio,
    user_id: str,
) -> list[dict[str, Any]]:
    args: dict[str, Any] = {
        "owner": owner,
        "repo": repo,
        "state": "all",
        "per_page": 20,
    }
    for s in ("GITHUB_LIST_ISSUES", "GITHUB_ISSUES_LIST"):
        d = execute_tool(composio, s, args, user_id)
        if d is None:
            continue
        if isinstance(d, list):
            return d
        if isinstance(d, dict):
            for k in ("data", "issues", "items"):
                v = d.get(k)
                if isinstance(v, list):
                    return v
    return []


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
        content=p,
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
        content=i,
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
            o = r.get("owner", {})
            owner = o.get("login", "") if isinstance(o, dict) else str(o or "")
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
        log.info("GitHub pull: %d raw items from %d repos", len(items), len(repos))
        return items
