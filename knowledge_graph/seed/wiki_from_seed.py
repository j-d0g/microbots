"""Seed the DB and regenerate all memory/ markdown files from the seed graph.

Usage:
    uv run python seed/wiki_from_seed.py [--dry-run]

This script:
1. Runs seed/seed.py to populate SurrealDB with realistic data
2. Runs the wiki agent against the seeded graph to (re)write every agents.md

It is the "no Composio, no LLM triage" path for local dev and e2e testing.
Requires DB to be up (make db-up) and schema applied (make db-schema).
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import subprocess
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("wiki_from_seed")

ROOT = Path(__file__).resolve().parent.parent


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Run wiki agent without writing files (prints what would change)",
    )
    p.add_argument(
        "--skip-seed",
        action="store_true",
        help="Skip re-seeding (use existing DB state)",
    )
    p.add_argument(
        "--memory-root",
        default=str(ROOT / "memory"),
        help="Path to memory/ directory (default: <repo>/memory)",
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


async def _run_wiki(dry_run: bool, memory_root: Path) -> None:
    from config import load_config, WikiConfig
    from wiki.orchestrator import run_wiki

    config = load_config()
    config.wiki.write_dry_run = dry_run

    log.info(
        "Running wiki agent (model=%s, dry_run=%s, memory_root=%s)",
        config.wiki.model,
        dry_run,
        memory_root,
    )

    result = await run_wiki(config, memory_root=memory_root)

    log.info(
        "Wiki complete: updated=%d unchanged=%d failed=%d",
        result.updated,
        result.unchanged,
        result.failed,
    )
    if result.failed:
        log.error("%d file(s) failed to update", result.failed)
        for d in result.details:
            if d.get("status") == "failed":
                log.error("  failed: %s", d.get("path"))
        sys.exit(1)


def main() -> None:
    args = _parse_args()
    memory_root = Path(args.memory_root).resolve()

    if not args.skip_seed:
        _run_seed()

    # Ensure memory/ subdirs exist
    for layer in ("integrations", "entities", "chats", "memories", "skills", "workflows"):
        (memory_root / layer).mkdir(parents=True, exist_ok=True)

    asyncio.run(_run_wiki(dry_run=args.dry_run, memory_root=memory_root))


if __name__ == "__main__":
    main()
