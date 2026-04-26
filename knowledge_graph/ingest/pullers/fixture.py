"""Fixture-based puller — loads pre-baked JSON instead of calling Composio.

Drop-in replacement for the real pullers used by `python -m ingest --from-fixtures`.
Reads from ``knowledge_graph/tests/fixtures/<set>/<integration>.json`` where
each entry has the shape::

    {
      "source_id":   "slack-2-deploy-...",
      "source_type": "slack_thread",
      "title":       "...",
      "content":     "Desmond: deploying microbots v0.2…",
      "occurred_at": "2025-01-15T18:00:00+00:00",
      "channel":     "#deployments",       # or any integration-specific extras
      "signal_level": "high"               # ignored — triage LLM reclassifies
    }

We intentionally don't pass ``signal_level`` through — the whole point of the
pipeline is to *learn* it via the triage LLM. Everything else lands in
``RawItem.metadata`` so the triage prompts can read it.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from composio import Composio

from config import Config
from ingest.pullers.base import BasePuller, RawItem

log = logging.getLogger(__name__)

# Repo-root resolution: ingest/pullers/fixture.py → up 3 levels → repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_FIXTURES = _REPO_ROOT / "knowledge_graph" / "tests" / "fixtures" / "train"


class FixturePuller(BasePuller):
    """A puller that reads from local JSON fixtures rather than Composio.

    Construct one per integration: ``FixturePuller("slack")``.
    """

    def __init__(self, integration: str, fixture_dir: Optional[Path] = None) -> None:
        self.name = integration
        self.fixture_dir = fixture_dir or _DEFAULT_FIXTURES
        self.fixture_path = self.fixture_dir / f"{integration}.json"

    async def pull(self, config: Config, composio: Composio) -> list[RawItem]:  # noqa: ARG002
        """Load fixture JSON and convert each entry to a ``RawItem``."""
        if not self.fixture_path.exists():
            log.warning(
                "fixture %s not found — returning 0 items",
                self.fixture_path,
            )
            return []

        with open(self.fixture_path, "r", encoding="utf-8") as f:
            entries = json.load(f)

        items: list[RawItem] = []
        for e in entries:
            external_id = e.get("source_id") or e.get("id")
            if not external_id:
                log.warning("fixture entry missing source_id, skipping: %r", e)
                continue

            occurred_str = e.get("occurred_at")
            occurred = (
                _parse_iso(occurred_str) if occurred_str else datetime.now(timezone.utc)
            )

            # Everything except the dedup key + occurred_at goes into content/metadata.
            # The triage LLM reads `content` directly.
            content = {
                "title":   e.get("title"),
                "body":    e.get("content"),
                # Pass any integration-specific fields straight through:
                **{
                    k: v
                    for k, v in e.items()
                    if k not in ("source_id", "id", "source_type", "occurred_at",
                                 "title", "content", "signal_level")
                },
            }

            items.append(
                RawItem(
                    external_id=external_id,
                    source_type=e.get("source_type", self.name),
                    integration=self.name,
                    content=content,
                    occurred_at=occurred,
                    metadata={"fixture": str(self.fixture_path.name)},
                )
            )

        log.info("fixture[%s]: loaded %d items from %s", self.name, len(items), self.fixture_path)
        return items


def _parse_iso(s: str) -> datetime:
    """Parse an ISO-8601 string, defaulting to UTC if no tz."""
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
