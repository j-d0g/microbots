"""Wiki page DB layer — Pydantic models + read/write helpers.

Implements the `wiki_page`/`wiki_parent`/`wiki_page_revision` access surface
described in the wiki_in_surrealdb_v1 plan. These helpers are mixed into
`MicrobotsDB` via composition (see db/client.py).
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import TYPE_CHECKING

import tiktoken
from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from surrealdb import AsyncSurreal

log = logging.getLogger(__name__)

_ENCODER: tiktoken.Encoding | None = None


def _encoder() -> tiktoken.Encoding:
    global _ENCODER
    if _ENCODER is None:
        _ENCODER = tiktoken.get_encoding("cl100k_base")
    return _ENCODER


def estimate_tokens(text: str) -> int:
    return len(_encoder().encode(text))


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class WikiPage(_Base):
    id: str | None = None
    path: str
    layer: str
    depth: int
    title: str = ""
    content: str = ""
    token_estimate: int = 0
    token_budget: int
    content_hash: str = ""
    revision: int = 0
    updated_at: datetime | None = None
    updated_by: str = "seed"


class WikiTreeNode(_Base):
    """Lightweight projection of a wiki_page used for ordering/traversal."""
    id: str
    path: str
    layer: str
    depth: int
    token_budget: int
    token_estimate: int = 0
    parent_path: str | None = None


class WikiWriteResult(_Base):
    path: str
    revision: int
    bytes_written: int
    token_estimate: int
    unchanged: bool


class WikiRevision(_Base):
    id: str | None = None
    page: str
    revision: int
    content: str
    content_hash: str
    token_estimate: int
    written_by: str
    written_at: datetime | None = None
    rationale: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stringify_record_id(value: object) -> str:
    """SurrealDB record IDs may come back as RecordID or dict; coerce to str."""
    if isinstance(value, str):
        return value
    # surrealdb-py RecordID has table_name / record_id
    table = getattr(value, "table_name", None)
    record = getattr(value, "record_id", None) or getattr(value, "id", None)
    if table and record is not None:
        return f"{table}:{record}"
    if isinstance(value, dict) and "tb" in value and "id" in value:
        return f"{value['tb']}:{value['id']}"
    return str(value)


# ---------------------------------------------------------------------------
# Wiki DB operations (used as mixin functions on MicrobotsDB)
# ---------------------------------------------------------------------------

async def get_wiki_page(surreal: "AsyncSurreal", path: str) -> WikiPage | None:
    rows = await surreal.query(
        "SELECT * FROM wiki_page WHERE path = $path LIMIT 1",
        {"path": path},
    )
    if not rows:
        return None
    row = rows[0] if isinstance(rows, list) else rows
    if isinstance(row, list):
        if not row:
            return None
        row = row[0]
    if not row:
        return None
    if "id" in row:
        row["id"] = _stringify_record_id(row["id"])
    return WikiPage.model_validate(row)


async def list_wiki_tree(surreal: "AsyncSurreal") -> list[WikiTreeNode]:
    """Return every wiki_page ordered depth ASC, then path.

    Each row carries `parent_path` resolved via the wiki_parent edge for easy
    traversal; root pages (depth=1) get parent_path=None.
    """
    rows = await surreal.query(
        """
        SELECT
            id, path, layer, depth, token_budget, token_estimate,
            (->wiki_parent->wiki_page.path)[0] AS parent_path
        FROM wiki_page
        ORDER BY depth ASC, path ASC
        """
    )
    if not rows:
        return []
    if isinstance(rows, dict):
        rows = [rows]
    out: list[WikiTreeNode] = []
    for r in rows:
        if "id" in r:
            r["id"] = _stringify_record_id(r["id"])
        out.append(WikiTreeNode.model_validate(r))
    return out


async def write_wiki_page(
    surreal: "AsyncSurreal",
    *,
    path: str,
    content: str,
    written_by: str = "wiki_agent",
    rationale: str | None = None,
    keep_revisions: int = 10,
) -> WikiWriteResult:
    """Atomically update a wiki_page + archive prior content as a revision.

    Idempotent: if the new content hashes to the existing content_hash, no
    write or revision bump occurs (returns unchanged=True).
    """
    new_hash = content_hash(content)
    new_tokens = estimate_tokens(content)

    current = await get_wiki_page(surreal, path)
    if current is None:
        # Schema-driven whitelist: agents may not invent paths.
        raise ValueError(
            f"wiki_page with path={path!r} does not exist. "
            "Add it to schema/04_wiki_seed.surql before writing."
        )

    if current.content_hash == new_hash and current.content == content:
        return WikiWriteResult(
            path=path,
            revision=current.revision,
            bytes_written=len(content.encode("utf-8")),
            token_estimate=current.token_estimate,
            unchanged=True,
        )

    new_revision = current.revision + 1

    # Archive previous revision if it had any content.
    if current.content and current.id is not None:
        page_key = current.id.split(":", 1)[1] if ":" in current.id else current.id
        await surreal.query(
            """
            CREATE wiki_page_revision SET
                page = type::thing("wiki_page", $page_key),
                revision = $revision,
                content = $content,
                content_hash = $hash,
                token_estimate = $tokens,
                written_by = $written_by,
                rationale = $rationale
            """,
            {
                "page_key": page_key,
                "revision": current.revision,
                "content": current.content,
                "hash": current.content_hash,
                "tokens": current.token_estimate,
                "written_by": current.updated_by,
                "rationale": rationale,
            },
        )

    # Update the page.
    await surreal.query(
        """
        UPDATE wiki_page SET
            content = $content,
            content_hash = $hash,
            token_estimate = $tokens,
            revision = $revision,
            updated_at = time::now(),
            updated_by = $written_by
        WHERE path = $path
        """,
        {
            "content": content,
            "hash": new_hash,
            "tokens": new_tokens,
            "revision": new_revision,
            "written_by": written_by,
            "path": path,
        },
    )

    # Trim revisions beyond keep_revisions oldest-first.
    if current.id is not None and keep_revisions > 0:
        page_key = current.id.split(":", 1)[1] if ":" in current.id else current.id
        rev_rows = await surreal.query(
            """
            SELECT id, revision FROM wiki_page_revision
            WHERE page = type::thing("wiki_page", $page_key)
            ORDER BY revision DESC
            """,
            {"page_key": page_key},
        )
        rev_list = rev_rows if isinstance(rev_rows, list) else []
        for stale in rev_list[keep_revisions:]:
            stale_id = stale.get("id") if isinstance(stale, dict) else None
            if stale_id is not None:
                await surreal.query(
                    "DELETE $rid",
                    {"rid": stale_id},
                )

    return WikiWriteResult(
        path=path,
        revision=new_revision,
        bytes_written=len(content.encode("utf-8")),
        token_estimate=new_tokens,
        unchanged=False,
    )


async def get_wiki_revisions(
    surreal: "AsyncSurreal", path: str, limit: int = 10
) -> list[WikiRevision]:
    """Return up to `limit` most-recent revisions for the page at `path`."""
    page = await get_wiki_page(surreal, path)
    if page is None or page.id is None:
        return []
    page_key = page.id.split(":", 1)[1] if ":" in page.id else page.id
    rows = await surreal.query(
        """
        SELECT * FROM wiki_page_revision
        WHERE page = type::thing("wiki_page", $page_key)
        ORDER BY revision DESC
        LIMIT $limit
        """,
        {"page_key": page_key, "limit": limit},
    )
    if not rows:
        return []
    if isinstance(rows, dict):
        rows = [rows]
    out: list[WikiRevision] = []
    for r in rows:
        if "id" in r:
            r["id"] = _stringify_record_id(r["id"])
        if "page" in r:
            r["page"] = _stringify_record_id(r["page"])
        out.append(WikiRevision.model_validate(r))
    return out


async def reset_wiki(surreal: "AsyncSurreal") -> int:
    """Soft reset: blank every wiki_page's content; keep skeleton + edges.

    Returns count of pages reset.
    """
    rows = await surreal.query(
        """
        UPDATE wiki_page SET
            content = "",
            content_hash = "",
            token_estimate = 0,
            revision = revision + 1,
            updated_at = time::now(),
            updated_by = "reset"
        RETURN AFTER
        """
    )
    if isinstance(rows, list):
        return len(rows)
    return 0
