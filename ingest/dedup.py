"""Deduplicate raw items using existing chat.source_id in SurrealDB."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ingest.db import select_source_ids_in
from ingest.pullers.base import RawItem

if TYPE_CHECKING:
    from surrealdb import AsyncSurreal

log = logging.getLogger(__name__)


async def dedup(items: list[RawItem], db: "AsyncSurreal") -> list[RawItem]:
    if not items:
        return []
    ids = [i.external_id for i in items]
    existing = await select_source_ids_in(db, ids)
    new_items = [i for i in items if i.external_id not in existing]
    log.info(
        "dedup: %d items, %d already in DB, %d new",
        len(items),
        len(items) - len(new_items),
        len(new_items),
    )
    return new_items
