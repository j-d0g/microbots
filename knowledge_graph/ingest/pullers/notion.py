"""Notion: search + page fetch (Composio tool slugs per toolkit docs)."""
from __future__ import annotations

import logging
from typing import Any

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem, utcnow
from ingest.pullers.execute import execute_tool

log = logging.getLogger(__name__)

_MAX_TEXT_CHARS = 4000  # ~1k tokens; truncate long pages for triage


def _as_search_results(d: Any) -> list[dict[str, Any]]:
    """Defensive multi-name extraction of page list from search response.

    Composio wraps responses in {"data": ...} (already unwrapped by execute_tool),
    and within data the Notion search payload uses {"results": [...]}.
    """
    if d is None:
        return []
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if not isinstance(d, dict):
        return []
    # If still wrapped (defensive), peel one layer.
    inner = d.get("data") if isinstance(d.get("data"), dict) else None
    candidates = [d, inner] if inner else [d]
    for c in candidates:
        for k in ("results", "pages", "items", "data"):
            v = c.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


def _search(
    composio: Composio, user_id: str, _config: Config
) -> list[dict[str, Any]]:
    for slug in ("NOTION_SEARCH_NOTION_PAGE", "NOTION_FETCH_DATA"):
        d = execute_tool(
            composio,
            slug,
            {
                "query": "",
                "page_size": 20,
            },
            user_id,
        )
        results = _as_search_results(d)
        if results:
            return results
    return []


def _get_page(
    composio: Composio, user_id: str, page_id: str
) -> dict[str, Any] | None:
    for slug in ("NOTION_RETRIEVE_PAGE",):
        d = execute_tool(
            composio, slug, {"page_id": page_id}, user_id
        )
        if isinstance(d, dict):
            # Defensive: peel one wrapper if execute didn't.
            inner = d.get("data")
            if isinstance(inner, dict) and inner.get("id"):
                return inner
            return d
    return None


def _get_page_markdown(
    composio: Composio, user_id: str, page_id: str
) -> str:
    """Fetch plain-text markdown of page content. Returns '' on failure."""
    d = execute_tool(
        composio,
        "NOTION_GET_PAGE_MARKDOWN",
        {"page_id": page_id},
        user_id,
    )
    if not isinstance(d, dict):
        return ""
    inner = d.get("data") if isinstance(d.get("data"), dict) else d
    md = inner.get("markdown") or inner.get("content") or ""
    return md if isinstance(md, str) else ""


def _extract_title(props: dict[str, Any]) -> str:
    """Extract plain-text title from a Notion properties dict."""
    if not isinstance(props, dict):
        return ""
    # Prefer the property explicitly typed 'title'.
    for _name, prop in props.items():
        if not isinstance(prop, dict):
            continue
        if prop.get("type") == "title":
            tlist = prop.get("title") or []
            return "".join(
                (t.get("plain_text") or "")
                for t in tlist
                if isinstance(t, dict)
            )
    # Fallback: a property literally named "Title" / "Name".
    for key in ("Title", "Name", "title", "name"):
        prop = props.get(key)
        if isinstance(prop, dict):
            tlist = prop.get("title") or prop.get("rich_text") or []
            if isinstance(tlist, list):
                return "".join(
                    (t.get("plain_text") or "")
                    for t in tlist
                    if isinstance(t, dict)
                )
    return ""


def _slim_page(
    page: dict[str, Any],
    page_id: str,
    markdown: str = "",
) -> dict[str, Any]:
    """Strip raw Notion page payload to triage-relevant fields only.

    Drops the full nested block tree, rich-text annotations, every property's
    internal id/type metadata, etc. Keeps id, title, url, last_edited_time,
    parent reference, and a truncated plain-text excerpt of page content.
    """
    if not isinstance(page, dict):
        return {"id": page_id, "placeholder": True}
    props = page.get("properties") or {}
    title = _extract_title(props)
    parent = page.get("parent") or {}
    parent_slim: dict[str, Any] = {}
    if isinstance(parent, dict):
        ptype = parent.get("type")
        parent_slim = {"type": ptype}
        # Capture whichever id key matches the parent type.
        for key in ("database_id", "page_id", "block_id", "workspace"):
            if key in parent:
                parent_slim[key] = parent.get(key)
    text = markdown or ""
    if len(text) > _MAX_TEXT_CHARS:
        text = (
            text[:_MAX_TEXT_CHARS]
            + f"\n…[truncated {len(text) - _MAX_TEXT_CHARS} chars]"
        )
    return {
        "id": page.get("id") or page_id,
        "object": page.get("object") or "page",
        "title": title,
        "url": page.get("url") or page.get("public_url") or "",
        "last_edited": page.get("last_edited_time"),
        "created": page.get("created_time"),
        "parent": parent_slim,
        "archived": bool(page.get("archived") or page.get("is_archived")),
        "text": text,
    }


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
            # NOTE: scope filtering by notion_databases is best-effort and
            # currently a no-op; preserved from prior behavior.
            if want and pid not in want:
                t = p.get("type", "")
                pobj = p.get("object", p.get("name", ""))
                if str(t) and str(t) not in (str(x) for x in want):
                    if str(pobj) and str(pobj) not in (str(x) for x in want):
                        pass
            det = _get_page(composio, user, pid) or p
            md = _get_page_markdown(composio, user, pid)
            slim = _slim_page(det if isinstance(det, dict) else p, pid, md)
            ext = f"notion:{pid}:page"
            out.append(
                RawItem(
                    external_id=ext,
                    source_type="notion_page",
                    integration="notion",
                    content=slim,
                    occurred_at=utcnow(),
                    metadata={"notion_id": pid},
                )
            )
        log.info("Notion pull: %d items (slim)", len(out))
        return out
