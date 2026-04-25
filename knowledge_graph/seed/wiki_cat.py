"""Print the content of one wiki page from the live DB.

Usage:
    uv run python knowledge_graph/seed/wiki_cat.py [path]

Defaults to `user.md`. Use `tree` as the path to list every page.
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


async def _tree() -> None:
    cfg = load_config()
    async with microbots_session(cfg) as db:
        nodes = await db.list_wiki_tree()
        for n in nodes:
            indent = "  " * (n.depth - 1)
            page = await db.get_wiki_page(n.path)
            est = page.token_estimate if page else 0
            rev = page.revision if page else 0
            print(f"{indent}{n.path:<46} budget={n.token_budget:>4} tokens={est:>4} rev={rev}")


async def _cat(path: str) -> None:
    cfg = load_config()
    async with microbots_session(cfg) as db:
        page = await db.get_wiki_page(path)
        if page is None:
            print(f"(no wiki_page row at path={path!r})")
            sys.exit(1)
        print(f"# {page.path}  (rev {page.revision}, by {page.updated_by}, "
              f"{len(page.content)} bytes, {page.token_estimate} tokens)")
        print()
        print(page.content)


def main() -> None:
    arg = sys.argv[1] if len(sys.argv) > 1 else "user.md"
    if arg == "tree":
        asyncio.run(_tree())
    else:
        asyncio.run(_cat(arg))


if __name__ == "__main__":
    main()
