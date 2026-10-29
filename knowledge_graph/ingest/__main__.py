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
            "See https://docs.composio.dev/docs/cli and knowledge_graph/README.md.",
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
    p.add_argument("--offline", action="store_true", help="Deterministic offline/demo outputs; requires --from-fixtures")
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
            "Runs full triage + enrich + wiki. Use --offline for no keys. "
            "Without --offline, requires OPENROUTER_API_KEY or ANTHROPIC_API_KEY. "
            "Composio API key is NOT required."
        ),
    )
    return p.parse_args()


async def _run(integration_names: list[str], config: Config, *, from_fixtures: bool = False) -> dict[str, int]:
    if config.offline and not from_fixtures:
        raise ValueError("Offline/demo mode requires --from-fixtures; live pullers are disabled")
    if from_fixtures:
        composio = None
    else:
        composio = _connect_composio(integration_names, config)
    if not config.offline and not (config.openrouter_api_key or config.anthropic_api_key):
        raise ValueError("Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY, or use --from-fixtures --offline")

    return await _ingest(integration_names, config, composio, from_fixtures=from_fixtures)


def _connect_composio(integration_names: list[str], config: Config):
    if not config.composio_api_key:
        raise ValueError("COMPOSIO_API_KEY is not set; use --from-fixtures --offline for the demo")

    try:
        resolved = resolve_composio_user_id(
            api_key=config.composio_api_key,
            requested_user_id=config.composio_user_id,
            integrations=integration_names,
        )
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Composio preflight failed: {e}") from e

    if resolved.user_id != config.composio_user_id:
        log.warning("Composio user_id override: %s", resolved.reason)
        config.composio_user_id = resolved.user_id
    else:
        log.info("Composio preflight: %s", resolved.reason)

    return Composio(api_key=config.composio_api_key)


async def _ingest(integration_names, config, composio, *, from_fixtures=False):

    results = {"success": 0, "failed": 0, "skipped_dedup": 0, "dropped": 0}
    new_chat_ids = []

    async with surreal_session(config) as db:
        for name in integration_names:
            log.info("Pulling %s...", name)
            puller = FixturePuller(name) if from_fixtures else get_puller(name)
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
            results["failed"] += wiki_results.failed
            log.info(
                "  Wiki: %d files updated, %d unchanged, %d failed",
                wiki_results.updated,
                wiki_results.unchanged,
                wiki_results.failed,
            )
        except Exception as e:  # noqa: BLE001
            results["failed"] += 1
            log.error("  Wiki agent failed: %s", e)

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
    config.offline = args.offline or config.offline
    if args.integrations:
        names = _select_integrations(config, args.integrations)
    else:
        names = enabled_integrations(config)

    if not names:
        log.error("No integrations to run. Enable in config and/or pass -i")
        sys.exit(1)
        return

    log.info("Ingest: integrations=%s mode=%s", names, "offline/demo" if config.offline else "live")
    try:
        r = asyncio.run(_run(names, config, from_fixtures=args.from_fixtures))
    except ValueError as exc:
        log.error("%s", exc)
        sys.exit(1)
    log.info(
        "Done. Wrote %d chat record(s), failed batch(es)=%d, "
        "skipped (dedup)=%d, dropped (low signal)=%d",
        r["success"],
        r["failed"],
        r["skipped_dedup"],
        r["dropped"],
    )
    if r["failed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
