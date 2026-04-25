"""Wiki orchestrator — walks targets in depth order, dispatches agent per file."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path

from config import Config
from db.client import microbots_session
from wiki.agent import WikiUpdate, build_wiki_agent
from wiki.budgets import budget_for
from wiki.deps import WikiDeps
from wiki.prompts.per_file import render_user_prompt
from wiki.targets import WikiTarget, derive_targets

log = logging.getLogger(__name__)


@dataclass
class WikiResult:
    updated: int = 0
    unchanged: int = 0
    failed: int = 0
    details: list[dict] = field(default_factory=list)


def _read_text_safe(path: Path) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


async def _run_one(
    target: WikiTarget,
    deps: WikiDeps,
    agent,
    slice_rows: list[dict],
) -> WikiUpdate | None:
    """Run the agent for a single target file."""
    existing = _read_text_safe(target.path)
    token_budget = budget_for(target.path, deps.memory_root)
    user_prompt = render_user_prompt(
        path=target.path,
        memory_root=deps.memory_root,
        existing_content=existing,
        graph_slice=slice_rows,
        token_budget=token_budget,
    )
    try:
        result = await agent.run(user_prompt, deps=deps)
        return result.output
    except Exception as e:
        log.error("wiki agent failed for %s: %s", target.path, e)
        return None


async def run_wiki(config: Config, memory_root: Path | None = None) -> WikiResult:
    """Main entry point: derive targets, dispatch agent, write files.

    Walker order: depth-3 → depth-2 → depth-1 (user.md).
    Depth-3 targets are independent and run in parallel (batches of config.wiki.max_concurrent).
    """
    if memory_root is None:
        memory_root = Path(__file__).resolve().parent.parent / "memory"

    wiki_cfg = config.wiki
    agent = build_wiki_agent(wiki_cfg)
    result = WikiResult()

    async with microbots_session(config) as db:
        deps = WikiDeps(db=db, memory_root=memory_root, config=wiki_cfg)

        targets = await derive_targets(db, memory_root)
        log.info("wiki: %d targets derived", len(targets))

        depth3 = [t for t in targets if t.depth == 3]
        depth2 = [t for t in targets if t.depth == 2]
        depth1 = [t for t in targets if t.depth == 1]

        # --- Phase A: depth-3 in parallel batches ---
        async def _process(target: WikiTarget) -> None:
            try:
                slice_rows = await db.named_query(target.query_name, target.query_params)
            except Exception as e:
                log.warning("wiki: slice query failed for %s: %s", target.path, e)
                slice_rows = []
            upd = await _run_one(target, deps, agent, slice_rows)
            if upd is None:
                result.failed += 1
                result.details.append({"path": str(target.path), "status": "failed"})
            else:
                changed = upd.content != _read_text_safe(target.path) if not wiki_cfg.write_dry_run else True
                result.updated += 1
                result.details.append({"path": str(target.path), "status": "updated", "rationale": upd.rationale})

        batch_size = wiki_cfg.max_concurrent
        for i in range(0, len(depth3), batch_size):
            batch = depth3[i : i + batch_size]
            await asyncio.gather(*[_process(t) for t in batch])

        # --- Phase B: depth-2 sequentially ---
        for target in depth2:
            await _process(target)

        # --- Phase C: depth-1 (user.md) ---
        for target in depth1:
            await _process(target)

    log.info(
        "wiki done: updated=%d unchanged=%d failed=%d",
        result.updated,
        result.unchanged,
        result.failed,
    )
    return result
