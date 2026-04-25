"""Seed the DB and run the wiki agent to populate every wiki_page.

Usage:
    uv run python knowledge_graph/seed/wiki_from_seed.py [--dry-run] [--skip-seed]

This script:
1. Runs seed/seed.py to populate SurrealDB with realistic data.
2. Runs the wiki agent against the seeded graph to fill the 18 wiki_page rows
   that were created by schema/04_wiki_seed.surql.

It is the "no Composio, no LLM triage" path for local dev. Requires the DB to
be up (make db-up) and schema applied (make db-schema).
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # = knowledge_graph/

# Allow running as a path script (e.g. `uv run python seed/wiki_from_seed.py`)
# by ensuring knowledge_graph/ is importable regardless of cwd.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("wiki_from_seed")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Run wiki agent without persisting to DB (logs what would change)",
    )
    p.add_argument(
        "--skip-seed",
        action="store_true",
        help="Skip re-seeding (use existing DB state)",
    )
    return p.parse_args()


def _run_seed() -> None:
    """Run seed.py as a subprocess so it gets its own asyncio loop."""
    log.info("Seeding DB...")
    result = subprocess.run(
        [sys.executable, str(ROOT / "seed" / "seed.py")],
        check=False,
    )
    if result.returncode != 0:
        log.error("seed.py exited with code %d", result.returncode)
        sys.exit(result.returncode)
    log.info("Seed complete.")


async def _run_wiki(dry_run: bool) -> None:
    from config import load_config
    from wiki.orchestrator import run_wiki

    config = load_config()
    config.wiki.write_dry_run = dry_run

    log.info(
        "Running wiki agent (model=%s, dry_run=%s)",
        config.wiki.openrouter_model,
        dry_run,
    )

    result = await run_wiki(config)

    log.info(
        "Wiki complete: updated=%d unchanged=%d failed=%d",
        result.updated,
        result.unchanged,
        result.failed,
    )
    if result.failed:
        log.error("%d page(s) failed to update", result.failed)
        for d in result.details:
            if d.get("status") == "failed":
                log.error("  failed: %s", d.get("path"))
        sys.exit(1)


def main() -> None:
    args = _parse_args()

    if not args.skip_seed:
        _run_seed()

    asyncio.run(_run_wiki(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
