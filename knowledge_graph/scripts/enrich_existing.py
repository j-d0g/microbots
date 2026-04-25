"""Run enrichment + wiki against every chat already in SurrealDB.

Useful when you've already ingested chats (e.g. via `python -m ingest --from-fixtures`)
but the enrichment phase failed or was interrupted. This script:

  1. Loads every chat record id from the DB
  2. Calls enrich.orchestrator.run_enrichment with that full list
  3. Calls wiki.orchestrator.run_wiki to populate wiki_page rows

It is idempotent — re-running just adds/updates memories, entities, skills,
workflows, and wiki pages. Existing rows aren't deleted.

Usage::

    PYTHONPATH=knowledge_graph .venv/Scripts/python -m scripts.enrich_existing
"""

from __future__ import annotations

import asyncio
import logging

from config import load_config
from ingest.db import surreal_session, unwrap_surreal_rows


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


async def main() -> None:
    config = load_config()

    async with surreal_session(config) as db:
        rows = unwrap_surreal_rows(await db.query("SELECT id FROM chat;"))
        chat_ids = [r["id"] for r in rows if r.get("id") is not None]
        log.info("Loaded %d existing chat ids from DB", len(chat_ids))
        if not chat_ids:
            log.warning("No chats in DB — run `python -m ingest --from-fixtures` first.")
            return

    # Phase 3: enrichment
    log.info("\u25b6 Running enrichment on %d chats\u2026", len(chat_ids))
    from enrich.orchestrator import run_enrichment
    enrich_results = await run_enrichment(chat_ids, config)
    log.info(
        "  Enrichment done: %d memories, %d entities resolved, %d skills, %d workflows",
        enrich_results["memories"],
        enrich_results["entities_resolved"],
        enrich_results["skills"],
        enrich_results["workflows"],
    )

    # Phase 4: wiki
    log.info("\u25b6 Running wiki agent\u2026")
    try:
        from wiki.orchestrator import run_wiki
        wiki_results = await run_wiki(config)
        log.info(
            "  Wiki done: %d files updated, %d unchanged, %d failed",
            wiki_results.updated,
            wiki_results.unchanged,
            wiki_results.failed,
        )
    except Exception:
        log.exception("Wiki agent failed (non-fatal)")


if __name__ == "__main__":
    asyncio.run(main())
