"""SurrealDB connection helpers for the ingest pipeline."""
from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator, Sequence
from typing import Any

from config import Config
from surrealdb import AsyncSurreal

log = logging.getLogger(__name__)


@contextlib.asynccontextmanager
async def surreal_session(config: Config) -> AsyncIterator[AsyncSurreal]:
    async with AsyncSurreal(config.surreal_url) as db:
        await db.signin(
            {
                "username": config.surreal_user,
                "password": config.surreal_password,
            }
        )
        await db.use(config.surreal_ns, config.surreal_db)
        yield db


def unwrap_surreal_rows(res: Any) -> list[dict[str, Any]]:
    """Normalize SurrealDB Python client query() return value (rows of records)."""
    if not res:
        return []
    # Direct list of record dicts (common for single-statement SELECT)
    if isinstance(res, list) and res and all(
        isinstance(x, dict) for x in res
    ):
        if "result" not in res[0] and "status" not in res[0]:
            return [x for x in res if isinstance(x, dict)]
    out: list[dict[str, Any]] = []
    parts = res if isinstance(res, (list, tuple)) else [res]
    for part in parts:
        if not isinstance(part, dict):
            continue
        r = part.get("result", part.get("results"))
        if r is None:
            continue
        if isinstance(r, list):
            for row in r:
                if isinstance(row, dict):
                    out.append(row)
        elif isinstance(r, dict):
            out.append(r)
    return out


async def select_source_ids_in(
    db: AsyncSurreal, source_ids: Sequence[str]
) -> set[str]:
    if not source_ids:
        return set()
    res = await db.query(
        "SELECT source_id FROM chat WHERE source_id IN $ids",
        {"ids": list(source_ids)},
    )
    rows = unwrap_surreal_rows(res)
    return {
        r["source_id"] for r in rows if r.get("source_id") is not None
    }
