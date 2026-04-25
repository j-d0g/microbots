"""End-to-end smoke: optional mock pull, triage (or stub), write, verify in SurrealDB."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from config import load_config
from ingest.db import surreal_session, unwrap_surreal_rows
from ingest.dedup import dedup
from ingest.pullers.base import RawItem, utcnow
from ingest.triage import triage_batch_with_retry
from ingest.writers.chat_records import write_chat_record
from ingest.writers.integration_metadata import write_integration_metadata

log = logging.getLogger(__name__)

MOCK_TR = {
    "integration_metadata": {
        "user_purpose": "Smoke test integration",
        "usage_patterns": ["e2e verification"],
        "navigation_tips": ["run: python -m ingest --smoke"],
        "key_entities": [
            {"name": "Test User", "type": "person", "role": "smoke actor"}
        ],
    },
    "chat_records": [
        {
            "external_id": "smoke:e2e:verify:1",
            "title": "Smoke test message",
            "summary": "Automated pipeline verification",
            "content": "This record confirms ingest writers and dedup work.",
            "signal_level": "high",
            "source_type": "smoke",
            "occurred_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "entities_mentioned": [
                {"name": "Test User", "mention_type": "author"}
            ],
        }
    ],
    "items_dropped": [],
}


def _mock_raw() -> list[RawItem]:
    return [
        RawItem(
            external_id="smoke:e2e:verify:1",
            source_type="smoke",
            integration="github",
            content={"note": "mock pull — no Composio call"},
            occurred_at=utcnow(),
            metadata={"smoke": True},
        )
    ]


async def run_smoke(*, use_llm: bool) -> bool:
    """Return True on success. Uses mock pull; triage is LLM or static JSON."""
    cfg = load_config()
    raw = _mock_raw()
    log.info("Smoke: %d mock raw item(s)", len(raw))

    async with surreal_session(cfg) as db:
        new_items = await dedup(raw, db)
        if not new_items:
            log.warning(
                "Dedup removed all items (smoke already ran). Delete chat with "
                "source_id smoke:e2e:verify:1 to re-run, or we still verify read."
            )
        else:
            if use_llm and (cfg.openrouter_api_key or cfg.anthropic_api_key):
                tri = await triage_batch_with_retry(new_items, "github", cfg)
                if tri is None:
                    log.error("Triage failed in smoke test")
                    return False
            else:
                if use_llm:
                    log.warning("No LLM API key; using static triage JSON for smoke")
                tri = MOCK_TR

            await write_integration_metadata("github", tri["integration_metadata"], db)
            for c in tri["chat_records"]:
                if str(c.get("signal_level", "mid")).lower() == "low":
                    continue
                await write_chat_record(c, "github", db)

        res = await db.query(
            "SELECT source_id, title FROM chat WHERE source_id = $sid",
            {"sid": "smoke:e2e:verify:1"},
        )
        rows = unwrap_surreal_rows(res)
        if not rows:
            log.error("Verify failed: no chat with source_id smoke:e2e:verify:1")
            return False
        log.info("Verify OK: %s", rows[0])
    return True


def smoke_should_run_llm() -> bool:
    return os.getenv("INGEST_SMOKE_USE_LLM", "").lower() in (
        "1",
        "true",
        "yes",
    )
