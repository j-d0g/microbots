"""Derive the ordered list of wiki target paths from the current graph state."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from db.client import MicrobotsDB

log = logging.getLogger(__name__)


@dataclass
class WikiTarget:
    """One file the wiki agent will produce/update."""
    path: Path           # absolute path under memory_root
    query_name: str      # named query to fetch the slice for this file
    query_params: dict[str, Any]
    depth: int           # 3=sub-layer, 2=layer, 1=user.md


async def derive_targets(db: MicrobotsDB, memory_root: Path) -> list[WikiTarget]:
    """Return targets ordered: depth-3 → depth-2 → depth-1 (user.md).

    Depth-3 files are independent and can be run in parallel batches.
    Depth-2 files summarise their children; run after depth-3.
    Depth-1 (user.md) runs last.
    """
    targets: list[WikiTarget] = []

    # --- depth-3: integration sub-layers ---
    try:
        intg_rows = await db.named_query("integrations_overview")
        for row in intg_rows:
            slug = row.get("slug", "")
            if not slug:
                continue
            targets.append(WikiTarget(
                path=memory_root / "integrations" / slug / "agents.md",
                query_name="integration_detail",
                query_params={"slug": slug, "limit": 10},
                depth=3,
            ))
    except Exception as e:
        log.warning("derive_targets: integrations_overview failed: %s", e)

    # --- depth-3: entity type sub-layers ---
    try:
        type_rows = await db.named_query("entity_types")
        for row in type_rows:
            etype = row.get("entity_type", "")
            if not etype:
                continue
            targets.append(WikiTarget(
                path=memory_root / "entities" / etype / "agents.md",
                query_name="entities_by_type",
                query_params={"entity_type": etype},
                depth=3,
            ))
    except Exception as e:
        log.warning("derive_targets: entity_types failed: %s", e)

    # --- depth-2: layer-level agents.md ---
    for layer in ("integrations", "entities", "chats", "memories", "skills", "workflows"):
        layer_query = {
            "integrations": ("integrations_overview", {}),
            "entities": ("entity_types", {}),
            "chats": ("chats_summary", {}),
            "memories": ("memories_top", {"limit": 20, "by": "confidence"}),
            "skills": ("skills_all", {"min_strength": 1}),
            "workflows": ("workflows_all", {}),
        }[layer]
        targets.append(WikiTarget(
            path=memory_root / layer / "agents.md",
            query_name=layer_query[0],
            query_params=layer_query[1],
            depth=2,
        ))

    # --- depth-1: user.md ---
    targets.append(WikiTarget(
        path=memory_root / "user.md",
        query_name="user_profile",
        query_params={},
        depth=1,
    ))

    return targets
