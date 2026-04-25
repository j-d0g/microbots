"""Run the wiki agent standalone: python -m wiki"""
from __future__ import annotations

import asyncio
import logging
import sys

from config import load_config
from wiki.orchestrator import run_wiki

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("wiki")


def main() -> None:
    config = load_config()
    log.info("Running wiki agent (model=%s, dry_run=%s)", config.wiki.model, config.wiki.write_dry_run)
    result = asyncio.run(run_wiki(config))
    log.info("Wiki complete: updated=%d unchanged=%d failed=%d", result.updated, result.unchanged, result.failed)
    if result.failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
