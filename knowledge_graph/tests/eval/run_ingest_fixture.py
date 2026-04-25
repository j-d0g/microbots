"""Fixture ingest + enrichment runner — Task 2 of E2E eval baseline.

Connects to SurrealDB, seeds user_profile + 6 integrations, injects all 6
train fixture JSON files as chat records (Composio bypassed), runs the full
enrichment pipeline, and reports counts.

Usage:
    uv run python tests/eval/run_ingest_fixture.py

Prerequisites:
    - docker compose up -d   (SurrealDB on :8000)
    - .env with SURREAL_* + OPENROUTER_API_KEY
    - uv sync
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
)
log = logging.getLogger("run_ingest_fixture")

ROOT = Path(__file__).resolve().parent.parent.parent  # = knowledge_graph/
FIXTURES_TRAIN = ROOT / "tests" / "fixtures" / "train"
INTEGRATIONS = ["slack", "github", "linear", "gmail", "notion", "perplexity"]


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

async def seed_base(db) -> None:
    """Upsert user_profile and all 6 integration nodes."""
    log.info("Seeding user_profile ...")
    await db.query("""
        UPSERT user_profile:default CONTENT {
            name: "Desmond", role: "AI engineer",
            goals: ["Build agent memory infrastructure",
                    "Automate triage and context management across integrations",
                    "Ship microbots as a reusable memory layer for AI agents"],
            preferences: {
                communication: "async-first",
                code_review: "thorough, prefer small PRs",
                deploy: "always notify #deployments before pushing to prod",
                linear_before_pr: true
            },
            context_window: 4000,
            created_at: time::now(), updated_at: time::now()
        }
    """)

    log.info("Seeding 6 integrations ...")
    integration_meta = {
        "slack":      ("Slack",       "communication", "daily"),
        "github":     ("GitHub",      "code",          "daily"),
        "linear":     ("Linear",      "project_mgmt",  "daily"),
        "gmail":      ("Gmail",       "communication", "daily"),
        "notion":     ("Notion",      "knowledge",     "weekly"),
        "perplexity": ("Perplexity",  "knowledge",     "daily"),
    }
    for slug, (name, cat, freq) in integration_meta.items():
        await db.query(f"""
            UPSERT integration:{slug} CONTENT {{
                name: "{name}", slug: "{slug}",
                category: "{cat}",
                description: "Integration node for {name}",
                user_purpose: "Used for {name} data",
                usage_patterns: [], navigation_tips: [],
                frequency: "{freq}",
                created_at: time::now(), updated_at: time::now()
            }}
        """)


# ---------------------------------------------------------------------------
# Chat injection (bypass Composio / triage)
# ---------------------------------------------------------------------------

async def inject_fixtures(db, integration: str, items: list[dict]) -> list:
    """Write fixture items directly as chat records, bypassing Composio/triage."""
    from surrealdb.data.types.record_id import RecordID

    chat_ids = []
    intg_rec = RecordID("integration", integration)

    for item in items:
        content_hash = hashlib.sha256(item.get("content", "").encode()).hexdigest()[:20]
        chat_id = f"fix_{integration}_{content_hash}"
        chat_rec = RecordID("chat", chat_id)

        await db.query(
            """
            UPSERT $chat CONTENT {
                title:        $title,
                content:      $content,
                source_type:  $stype,
                source_id:    $sid,
                signal_level: $sig,
                summary:      $content,
                occurred_at:  time::now(),
                created_at:   time::now()
            }
            """,
            {
                "chat":    chat_rec,
                "title":   item.get("title", ""),
                "content": item.get("content", ""),
                "stype":   item.get("source_type", integration),
                "sid":     item.get("source_id", ""),
                "sig":     item.get("signal_level", "mid"),
            },
        )
        await db.query(
            "RELATE $c->chat_from->$intg",
            {"c": chat_rec, "intg": intg_rec},
        )
        chat_ids.append(chat_rec)

    log.info("  Injected %d chats for integration=%s", len(chat_ids), integration)
    return chat_ids


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    from surrealdb import AsyncSurreal
    from config import load_config
    from enrich.orchestrator import run_enrichment

    config = load_config()

    log.info("Connecting to SurrealDB at %s (ns=%s db=%s) ...",
             config.surreal_url, config.surreal_ns, config.surreal_db)

    async with AsyncSurreal(config.surreal_url) as db:
        await db.signin({"username": config.surreal_user,
                         "password": config.surreal_password})
        await db.use(config.surreal_ns, config.surreal_db)

        # --- Step 1: Seed base data ---
        await seed_base(db)

        # --- Step 2: Inject all 6 fixture files ---
        all_chat_ids = []
        fixture_counts: dict[str, int] = {}
        for intg in INTEGRATIONS:
            path = FIXTURES_TRAIN / f"{intg}.json"
            if not path.exists():
                log.warning("Missing fixture: %s", path)
                continue
            items: list[dict] = json.loads(path.read_text())
            ids = await inject_fixtures(db, intg, items)
            all_chat_ids.extend(ids)
            fixture_counts[intg] = len(ids)

        total_injected = sum(fixture_counts.values())
        log.info("Total chats injected: %d  %s", total_injected, fixture_counts)

        # --- Step 3: Run enrichment pipeline ---
        if not config.openrouter_api_key:
            log.error("OPENROUTER_API_KEY not set — enrichment will fail. Aborting.")
            sys.exit(1)

        log.info("Running enrichment pipeline on %d new chat IDs ...", len(all_chat_ids))
        counts = await run_enrichment(all_chat_ids, config)

        # --- Step 4: Report ---
        print("\n" + "=" * 60)
        print("FIXTURE INGEST + ENRICHMENT REPORT")
        print("=" * 60)
        print(f"Chats injected  : {total_injected}")
        for intg, n in fixture_counts.items():
            print(f"  {intg:<12}: {n}")
        print()
        print(f"Memories written        : {counts['memories']}")
        print(f"Entities resolved       : {counts['entities_resolved']}")
        print(f"Skills written          : {counts['skills']}")
        print(f"Workflows written       : {counts['workflows']}")
        print("=" * 60 + "\n")

        return counts


if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(0)
