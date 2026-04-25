"""Composio tools.execute wrapper with logging."""
from __future__ import annotations

import logging
from typing import Any

from composio import Composio

log = logging.getLogger(__name__)


def execute_tool(
    composio: Composio,
    slug: str,
    arguments: dict[str, Any],
    user_id: str,
) -> dict[str, Any] | None:
    out = composio.tools.execute(
        slug,
        arguments,
        user_id=user_id,
        dangerously_skip_version_check=True,
    )
    if not out.get("successful"):
        log.warning("Composio tool %s failed: %s", slug, out.get("error"))
        return None
    return out.get("data") or {}
