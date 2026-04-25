"""Soft-reset every wiki_page.content to "" against the live DB.

Usage:
    uv run python knowledge_graph/seed/wiki_reset.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # = knowledge_graph/
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import load_config  # noqa: E402
from db.client import microbots_session  # noqa: E402


async def main() -> None:
    cfg = load_config()
    async with microbots_session(cfg) as db:
        n = await db.reset_wiki()
        print(f"reset {n} wiki pages")


if __name__ == "__main__":
    asyncio.run(main())
