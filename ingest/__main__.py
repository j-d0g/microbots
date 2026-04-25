"""CLI: Composio pull → dedup → triage → SurrealDB."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

# Writable Composio cache (before importing composio)
_root = Path(__file__).resolve().parent.parent
_composio_cache = _root / ".composio_cache"
_composio_cache.mkdir(exist_ok=True)
os.environ.setdefault("COMPOSIO_CACHE_DIR", str(_composio_cache))

from config import Config, load_config
from composio import Composio
from ingest.dedup import dedup
from ingest.db import surreal_session
from ingest.e2e_smoke import run_smoke, smoke_should_run_llm
from ingest.pullers import enabled_integrations, get_puller
from ingest.triage import chunk, parallel_triage
from ingest.writers.chat_records import write_chat_record
from ingest.writers.integration_metadata import write_integration_metadata

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("ingest")


def _log_composio_pull_hint(exc: BaseException, config: Config) -> None:
    """Point users at CLI auth / tool slugs when Composio errors are recognizable."""
    text = str(exc)
    if "connected account" in text.lower() or "ConnectedAccountNotFound" in text:
        log.error(
            "Composio has no connected account for this app under COMPOSIO_USER_ID=%r. "
            "Run: composio login && composio link <toolkit> (e.g. composio link github, composio link perplexityai). "
            "See https://docs.composio.dev/docs/cli and `make composio-auth`.",
            config.composio_user_id,
        )
    if "not found" in text.lower() and "tool" in text.lower():
        log.error(
            "Composio tool slug may not exist in this API version. "
            "Check app.composio.dev and update ingest/pullers/ for the integration.",
        )


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--integration",
        "-i",
        action="append",
        dest="integrations",
        metavar="NAME",
        help="Run only this integration (repeatable). Default: all enabled in config",
    )
    p.add_argument(
        "--smoke",
        action="store_true",
        help="Run end-to-end smoke test (mock pull, triage+write, verify)",
    )
    return p.parse_args()


async def _run(integration_names: list[str], config: Config) -> dict[str, int]:
    if not config.composio_api_key:
        log.error("COMPOSIO_API_KEY is not set")
        return {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}

    composio = Composio(api_key=config.composio_api_key)

    if not (config.openrouter_api_key or config.anthropic_api_key):
        log.error("Set OPENROUTER_API_KEY and/or ANTHROPIC_API_KEY for triage")
        return {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}

    results = {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}

    async with surreal_session(config) as db:
        for name in integration_names:
            log.info("▶ Pulling %s…", name)
            puller = get_puller(name)
            try:
                raw_items = await puller.pull(config, composio)
            except Exception as e:  # noqa: BLE001
                _log_composio_pull_hint(e, config)
                log.exception("Pull failed for %s", name)
                results["failed"] += 1
                continue

            log.info("  Fetched %d raw items", len(raw_items))
            new_items = await dedup(raw_items, db)
            results["skipped_dedup"] += len(raw_items) - len(new_items)
            log.info("  %d new after dedup", len(new_items))

            if not new_items:
                continue

            batches = chunk(new_items, config.pipeline.batch_size)
            log.info("  Triage: %d batch(es) (parallel up to %d)", len(batches), config.pipeline.parallel_llm_calls)
            triage_results = await parallel_triage(batches, name, config)

            for tr in triage_results:
                if tr is None:
                    results["failed"] += 1
                    log.warning("  A triage batch failed (see logs above)")
                    continue
                await write_integration_metadata(
                    name, tr["integration_metadata"], db
                )
                for chat in tr.get("chat_records", []):
                    if str(chat.get("signal_level", "mid")).lower() == "low":
                        continue
                    await write_chat_record(chat, name, db)
                    results["success"] += 1
                results["dropped"] += len(tr.get("items_dropped", []))

    return results


def _select_integrations(
    config: Config, user_list: list[str] | None
) -> list[str]:
    e = enabled_integrations(config)
    if not user_list:
        return e
    req = {x.lower() for x in user_list}
    for r in req:
        if r not in {i.lower() for i in e}:
            log.warning("Unknown or disabled integration: %s (ignored)", r)
    return [i for i in e if i.lower() in req]


def main() -> None:
    args = _parse_args()
    if args.smoke:
        use_llm = smoke_should_run_llm()
        ok = asyncio.run(run_smoke(use_llm=use_llm))
        sys.exit(0 if ok else 1)
        return

    config = load_config()
    if args.integrations:
        names = _select_integrations(config, args.integrations)
    else:
        names = enabled_integrations(config)

    if not names:
        log.error("No integrations to run. Enable in config and/or pass -i")
        sys.exit(1)
        return

    log.info("Ingest: integrations=%s (LLM=%s)", names, config.llm.provider)
    r = asyncio.run(_run(names, config))
    log.info(
        "Done. Wrote %d chat record(s), failed batch(es)=%d, "
        "skipped (dedup)=%d, dropped (low signal)=%d",
        r["success"],
        r["failed"],
        r["skipped_dedup"],
        r["dropped"],
    )
    if r["failed"] and r["success"] == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
