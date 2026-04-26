"""Scrub sensitive specifics from the graph while preserving the demo story.

Mutations applied (in order):

1.  Cognition coupon code `URZT9ZIU` → `<REDACTED-COUPON>`
2.  Personal email `jpfdjsldfjik@gmail.com` → `<personal-email>`
3.  Specific share/recording URLs → generic placeholders
4.  Email addresses `<local>@<domain>` → just the local part (Rebecca, Nader,
    fatema, etc. stay readable; companies inferred from context).

Run via:
    cd knowledge_graph && uv run python -m candidates.scrub          # scrub
    cd knowledge_graph && uv run python -m candidates.scrub --dry    # preview

After scrubbing, re-run `make snapshot` to refresh the on-disk dump.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import re

from surrealdb import AsyncSurreal

log = logging.getLogger("candidates.scrub")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


# ---- Mutation rules -------------------------------------------------------

# Order matters: most specific first.
MUTATIONS: list[tuple[re.Pattern, str]] = [
    # 1. Coupon code (8-char uppercase code in the Cognition email)
    (re.compile(r"URZT9ZIU"), "<REDACTED-COUPON>"),
    # 2. Personal Composio login (random-looking gmail)
    (re.compile(r"jpfdjsldfjik@gmail\.com", re.I), "<personal-email>"),
    # 3. Luma share keys (revealing event-link secrets)
    (re.compile(r"https://luma\.com/(?:e/ticket/)?[\w\-]+\?pk=[\w\-]+"), "https://luma.com/<event-link>"),
    # 4. Specific Google Drive recording URLs
    (re.compile(r"https://drive\.google\.com/file/d/[\w\-]+/view\??[^\s\"')]*"), "<internal-recording-link>"),
    # 5. Notion register pages (specific page IDs)
    (re.compile(r"https://(?:www\.)?notion\.so/agemo[\w\-/]+"), "<internal-notion-link>"),
    # 6. Drop full email addresses to their local-part (preserves "Rebecca", "Nader", "fatema").
    #    Skipped for the user's own work email which we can leave intact.
    (re.compile(r"\b([A-Za-z0-9._-]+)@(?!agemo\.ai\b)([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b"), r"\1"),
    # 7. The user's own work email — keep first name only
    (re.compile(r"\bjordan@agemo\.ai\b", re.I), "jordan"),
    # 8. Other agemo.ai addresses → just first name
    (re.compile(r"\b([A-Za-z0-9._-]+)@agemo\.ai\b"), r"\1"),
]


def scrub_text(s: str | None) -> str | None:
    if not s:
        return s
    out = s
    for pat, repl in MUTATIONS:
        out = pat.sub(repl, out)
    return out


# ---- Field maps -----------------------------------------------------------

# Tables and their string fields to scrub.
TABLES_FIELDS: dict[str, list[str]] = {
    "chat": ["title", "summary", "content"],
    "memory": ["title", "content"],
    "entity": ["name", "description"],
    "skill": ["name", "description"],
    "wiki_page": ["title", "content"],
    "automation_candidate": ["title", "story", "suggested_action"],
    "user_profile": ["name", "email", "bio"],  # if present
}


async def scrub_table(db: AsyncSurreal, table: str, fields: list[str], dry: bool) -> int:
    rows = await db.query(f"SELECT id, {', '.join(fields)} FROM {table};")
    changes = 0
    for r in rows or []:
        rid = str(r["id"])
        updates: dict[str, str] = {}
        for f in fields:
            orig = r.get(f)
            new = scrub_text(orig) if isinstance(orig, str) else orig
            if isinstance(new, str) and new != orig:
                updates[f] = new
        if updates:
            changes += 1
            if dry:
                preview = ", ".join(f"{k}={v[:60]!r}" for k, v in updates.items())
                log.info("[DRY] %s: %s", rid, preview)
            else:
                # Apply field-by-field so we don't accidentally drop other fields.
                for f, v in updates.items():
                    await db.query(
                        f"UPDATE {rid} SET {f} = $v;", {"v": v}
                    )
    return changes


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dry", action="store_true", help="Preview changes without writing")
    args = p.parse_args()

    url = os.environ.get("SURREAL_URL", "ws://localhost:8000/rpc")
    db = AsyncSurreal(url)
    await db.connect()
    await db.signin({"username": os.environ["SURREAL_USER"], "password": os.environ["SURREAL_PASS"]})
    await db.use(os.environ["SURREAL_NS"], os.environ["SURREAL_DB"])

    total = 0
    for table, fields in TABLES_FIELDS.items():
        try:
            n = await scrub_table(db, table, fields, dry=args.dry)
            log.info("%s: %d row(s) %s", table, n, "would change" if args.dry else "scrubbed")
            total += n
        except Exception as e:
            log.warning("%s skipped: %s", table, e)
    log.info("Total %s: %d", "previewed" if args.dry else "scrubbed", total)

    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
