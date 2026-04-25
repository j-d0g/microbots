"""CLI: Composio pull → dedup → triage → SurrealDB."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

# Writable Composio cache (before importing composio)
# parent.parent = knowledge_graph/, parent.parent.parent = git root
_root = Path(__file__).resolve().parent.parent.parent
_composio_cache = _root / ".composio_cache"
_composio_cache.mkdir(exist_ok=True)
os.environ.setdefault("COMPOSIO_CACHE_DIR", str(_composio_cache))

from config import Config, load_config
from composio import Composio
from ingest.composio_user import resolve_composio_user_id
from ingest.dedup import dedup
from ingest.db import surreal_session
from ingest.e2e_smoke import run_smoke, smoke_should_run_llm
from ingest.pullers import enabled_integrations, get_puller
from ingest.pullers.base import BasePuller
from ingest.pullers.fixture import FixturePuller
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
    p.add_argument(
        "--from-fixtures",
        action="store_true",
        help=(
            "Skip Composio entirely; pull raw items from "
            "knowledge_graph/tests/fixtures/train/<integration>.json. "
            "Still runs full triage + enrich + wiki against real LLM. "
            "Requires OPENROUTER_API_KEY (or ANTHROPIC_API_KEY). "
            "Composio API key is NOT required."
        ),
    )
    return p.parse_args()


async def _run_from_fixtures(integration_names: list[str], config: Config) -> dict[str, int]:
    """Same as ``_run`` but uses ``FixturePuller`` and skips Composio preflight.

    Useful for end-to-end testing without OAuth-connected accounts. Real LLM
    triage + enrichment + wiki still run against the cloud SurrealDB.
    """
    if not (config.openrouter_api_key or config.anthropic_api_key):
        log.error("--from-fixtures still needs an LLM key. Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY.")
        return {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}

    results = {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}
    new_chat_ids = []

    async with surreal_session(config) as db:
        for name in integration_names:
            log.info("\u25b6 Loading fixture for %s\u2026", name)
            puller: BasePuller = FixturePuller(name)
            try:
                # composio is None — fixtures don't need it.
                raw_items = await puller.pull(config, None)  # type: ignore[arg-type]
            except Exception:  # noqa: BLE001
                log.exception("Fixture load failed for %s", name)
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
                await write_integration_metadata(name, tr["integration_metadata"], db)
                for chat in tr.get("chat_records", []):
                    if str(chat.get("signal_level", "mid")).lower() == "low":
                        continue
                    chat_rec_id = await write_chat_record(chat, name, db)
                    new_chat_ids.append(chat_rec_id)
                    results["success"] += 1
                results["dropped"] += len(tr.get("items_dropped", []))

    if results["success"] > 0:
        log.info("\u25b6 Starting enrichment layer (%d new chats)\u2026", results["success"])
        from enrich.orchestrator import run_enrichment
        enrich_results = await run_enrichment(new_chat_ids, config)
        log.info(
            "  Enrichment: %d memories, %d entities resolved, %d skills, %d workflows",
            enrich_results["memories"],
            enrich_results["entities_resolved"],
            enrich_results["skills"],
            enrich_results["workflows"],
        )
        log.info("\u25b6 Starting wiki agent (Phase 4)\u2026")
        try:
            from wiki.orchestrator import run_wiki
            wiki_results = await run_wiki(config)
            log.info(
                "  Wiki: %d files updated, %d unchanged, %d failed",
                wiki_results.updated,
                wiki_results.unchanged,
                wiki_results.failed,
            )
        except Exception as e:  # noqa: BLE001
            log.error("  Wiki agent failed (non-fatal): %s", e)

    return results


async def _run(integration_names: list[str], config: Config) -> dict[str, int]:
    if not config.composio_api_key:
        log.error("COMPOSIO_API_KEY is not set")
        return {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}

    try:
        resolved = resolve_composio_user_id(
            api_key=config.composio_api_key,
            requested_user_id=config.composio_user_id,
            integrations=integration_names,
        )
    except Exception as e:  # noqa: BLE001
        log.error("Composio preflight failed: %s", e)
        return {"success": 0, "failed": len(integration_names), "skipped_dedup": 0, "dropped": 0}

    if resolved.user_id != config.composio_user_id:
        log.warning("Composio user_id override: %s", resolved.reason)
        config.composio_user_id = resolved.user_id
    else:
        log.info("Composio preflight: %s", resolved.reason)

    composio = Composio(api_key=config.composio_api_key)

    if not (config.openrouter_api_key or config.anthropic_api_key):
        log.error("Set OPENROUTER_API_KEY and/or ANTHROPIC_API_KEY for triage")
        return {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}

    results = {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}
    new_chat_ids = []

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
                    chat_rec_id = await write_chat_record(chat, name, db)
                    new_chat_ids.append(chat_rec_id)
                    results["success"] += 1
                results["dropped"] += len(tr.get("items_dropped", []))

    # Phase 3: Enrichment (separate session, same cycle's chat IDs)
    if results["success"] > 0:
        log.info("▶ Starting enrichment layer (%d new chats)…", results["success"])
        from enrich.orchestrator import run_enrichment
        enrich_results = await run_enrichment(new_chat_ids, config)
        log.info(
            "  Enrichment: %d memories, %d entities resolved, %d skills, %d workflows",
            enrich_results["memories"],
            enrich_results["entities_resolved"],
            enrich_results["skills"],
            enrich_results["workflows"],
        )

        # Phase 4: Wiki agent — diff-update the memory/ markdown layer
        log.info("▶ Starting wiki agent (Phase 4)…")
        try:
            from wiki.orchestrator import run_wiki
            wiki_results = await run_wiki(config)
            log.info(
                "  Wiki: %d files updated, %d unchanged, %d failed",
                wiki_results.updated,
                wiki_results.unchanged,
                wiki_results.failed,
            )
        except Exception as e:  # noqa: BLE001
            log.error("  Wiki agent failed (non-fatal): %s", e)

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

    if args.from_fixtures:
        log.info("Ingest [fixtures]: integrations=%s (LLM=%s)", names, config.llm.provider)
        r = asyncio.run(_run_from_fixtures(names, config))
    else:
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
