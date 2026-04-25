"""MicrobotsDB — typed SurrealDB connection wrapper.

Inspired by surrealdb/kaig's DB class:
- Single connection + namespace/database context.
- All queries are named (whitelisted); no raw SurrealQL from outside.
- Results are returned as lists of Pydantic models (or raw dicts when no model is registered).
"""
from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator
from typing import Any

from pydantic import BaseModel
from surrealdb import AsyncSurreal

from config import Config
from db.queries import NAMED_QUERIES, QueryDef
from db.wiki import (
    WikiPage,
    WikiRevision,
    WikiTreeNode,
    WikiWriteResult,
    get_wiki_page,
    get_wiki_revisions,
    list_wiki_tree,
    reset_wiki,
    write_wiki_page,
)
from ingest.db import unwrap_surreal_rows

log = logging.getLogger(__name__)


class MicrobotsDB:
    """Typed wrapper around an AsyncSurreal connection.

    Use as an async context manager or inject via surreal_session factory.
    """

    def __init__(self, db: AsyncSurreal) -> None:
        self._db = db

    # ------------------------------------------------------------------
    # Named query interface
    # ------------------------------------------------------------------

    def _get_query_def(self, name: str) -> QueryDef:
        if name not in NAMED_QUERIES:
            raise ValueError(
                f"Unknown named query '{name}'. "
                f"Allowed: {sorted(NAMED_QUERIES)}"
            )
        return NAMED_QUERIES[name]

    async def named_query(
        self,
        name: str,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Run a whitelisted named query, return raw dict rows."""
        qdef = self._get_query_def(name)
        safe_params = qdef.validated_params(params or {})

        # Special handling for queries with dynamic ORDER field
        surql = qdef.surql
        if name == "memories_top":
            by = safe_params.pop("by", "confidence")
            order_field = "confidence" if by == "confidence" else "created_at"
            surql = surql.replace("{order_field}", order_field)
            safe_params.setdefault("limit", 20)

        try:
            res = await self._db.query(surql, safe_params)
        except Exception as e:
            log.error("named_query '%s' failed: %s", name, e)
            raise

        rows = unwrap_surreal_rows(res)
        return rows

    async def named_query_typed(
        self,
        name: str,
        params: dict[str, Any] | None = None,
    ) -> list[BaseModel]:
        """Run a named query and coerce rows to the declared Pydantic model.

        Falls back to raw dict rows (wrapped in a simple model) if no result_model
        is declared, or if a row fails validation (logs a warning, skips the row).
        """
        qdef = self._get_query_def(name)
        rows = await self.named_query(name, params)
        if not qdef.result_model:
            return rows  # type: ignore[return-value]

        out: list[BaseModel] = []
        for row in rows:
            try:
                out.append(qdef.result_model.model_validate(row))
            except Exception as e:
                log.warning("named_query '%s' row validation failed: %s — row=%r", name, e, row)
        return out

    # ------------------------------------------------------------------
    # Raw write helpers (kept minimal — prefer enrich/writers for writes)
    # ------------------------------------------------------------------

    async def raw_query(self, surql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Internal raw query — only called by this module or tests, never by LLM tools."""
        res = await self._db.query(surql, params or {})
        return unwrap_surreal_rows(res)

    # ------------------------------------------------------------------
    # Pass-through to underlying AsyncSurreal for writers
    # ------------------------------------------------------------------

    @property
    def surreal(self) -> AsyncSurreal:
        return self._db

    # ------------------------------------------------------------------
    # Wiki page operations (see db/wiki.py)
    # ------------------------------------------------------------------

    async def get_wiki_page(self, path: str) -> WikiPage | None:
        return await get_wiki_page(self._db, path)

    async def list_wiki_tree(self) -> list[WikiTreeNode]:
        return await list_wiki_tree(self._db)

    async def write_wiki_page(
        self,
        path: str,
        content: str,
        *,
        written_by: str = "wiki_agent",
        rationale: str | None = None,
        keep_revisions: int = 10,
    ) -> WikiWriteResult:
        return await write_wiki_page(
            self._db,
            path=path,
            content=content,
            written_by=written_by,
            rationale=rationale,
            keep_revisions=keep_revisions,
        )

    async def get_wiki_revisions(
        self, path: str, limit: int = 10
    ) -> list[WikiRevision]:
        return await get_wiki_revisions(self._db, path, limit=limit)

    async def reset_wiki(self) -> int:
        return await reset_wiki(self._db)


# ------------------------------------------------------------------
# Session factory
# ------------------------------------------------------------------

@contextlib.asynccontextmanager
async def microbots_session(config: Config) -> AsyncIterator[MicrobotsDB]:
    """Open a SurrealDB session, sign in, set NS/DB, yield a MicrobotsDB."""
    async with AsyncSurreal(config.surreal_url) as surreal:
        await surreal.signin(
            {"username": config.surreal_user, "password": config.surreal_password}
        )
        await surreal.use(config.surreal_ns, config.surreal_db)
        yield MicrobotsDB(surreal)
