"""Wiki orchestrator — walks wiki_page rows in depth order, dispatches agent per page."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from config import Config
from db.client import microbots_session
from db.wiki import WikiTreeNode
from wiki.agent import WikiUpdate, build_wiki_agent
from wiki.deps import WikiDeps
from wiki.prompts.per_file import render_user_prompt

log = logging.getLogger(__name__)


@dataclass
class WikiResult:
    updated: int = 0
    unchanged: int = 0
    failed: int = 0
    details: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Slice-query routing: every wiki_page path → (query_name, params)
# ---------------------------------------------------------------------------

def _slice_for(node: WikiTreeNode) -> tuple[str, dict[str, Any]]:
    """Pick the named query + params used to populate this page's prompt.

    Falls back to user_profile for anything we don't have a specific slice for.
    """
    path = node.path

    if path == "user.md":
        return "user_profile", {}

    # depth-3 integration sub-pages
    if path.startswith("integrations/") and path.endswith("/agents.md"):
        slug = path.split("/", 2)[1]
        return "integration_detail", {"slug": slug, "limit": 10}

    # depth-3 entity-type sub-pages
    if path.startswith("entities/") and path.endswith("/agents.md") and path.count("/") == 2:
        etype = path.split("/", 2)[1]
        return "entities_by_type", {"entity_type": etype}

    # depth-2 layer summary pages
    layer_query: dict[str, tuple[str, dict[str, Any]]] = {
        "integrations/agents.md": ("integrations_overview", {}),
        "entities/agents.md":     ("entity_types", {}),
        "chats/agents.md":        ("chats_summary", {}),
        "memories/agents.md":     ("memories_top", {"limit": 20, "by": "confidence"}),
        "skills/agents.md":       ("skills_all", {"min_strength": 1}),
        "workflows/agents.md":    ("workflows_all", {}),
    }
    if path in layer_query:
        return layer_query[path]

    log.warning("orchestrator: no slice mapping for path=%s, falling back to user_profile", path)
    return "user_profile", {}


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

async def _run_one(
    node: WikiTreeNode,
    deps: WikiDeps,
    agent,
    slice_rows: list[dict],
    existing_content: str,
) -> WikiUpdate | None:
    """Run the agent for a single wiki page."""
    user_prompt = render_user_prompt(
        path=node.path,
        existing_content=existing_content,
        graph_slice=slice_rows,
        token_budget=node.token_budget,
        parent_path=node.parent_path,
    )
    try:
        result = await agent.run(user_prompt, deps=deps)
        return result.output
    except Exception as e:
        log.error("wiki agent failed for %s: %s", node.path, e)
        return None


async def run_wiki(config: Config) -> WikiResult:
    """Main entry point: enumerate wiki_page rows, dispatch agent per page, write back.

    Walker order: depth-3 → depth-2 → depth-1 (user.md). Depth-3 runs in parallel
    batches of `config.wiki.max_concurrent`; depths 2 and 1 run sequentially.
    """
    wiki_cfg = config.wiki
    agent = build_wiki_agent(wiki_cfg)
    result = WikiResult()

    async with microbots_session(config) as db:
        deps = WikiDeps(db=db, config=wiki_cfg)

        tree = await db.list_wiki_tree()
        log.info("wiki: %d pages in tree", len(tree))

        depth3 = [n for n in tree if n.depth == 3]
        depth2 = [n for n in tree if n.depth == 2]
        depth1 = [n for n in tree if n.depth == 1]

        async def _process(node: WikiTreeNode) -> None:
            qname, qparams = _slice_for(node)
            try:
                slice_rows = await db.named_query(qname, qparams)
            except Exception as e:
                log.warning("wiki: slice query %s failed for %s: %s", qname, node.path, e)
                slice_rows = []

            page = await db.get_wiki_page(node.path)
            existing = page.content if page else ""

            upd = await _run_one(node, deps, agent, slice_rows, existing)
            if upd is None:
                result.failed += 1
                result.details.append({"path": node.path, "status": "failed"})
                return

            # The agent should have called `write_markdown` (via tool_write_markdown
            # → db.write_wiki_page) inside its run. Re-fetch to verify and capture
            # the post-run revision. If the agent skipped the write, fall back to
            # writing from `upd.content` so the page is never left blank.
            page_after = await db.get_wiki_page(node.path)
            agent_wrote = (
                page_after is not None
                and page_after.content == upd.content
            )

            if not agent_wrote and upd.content and not wiki_cfg.write_dry_run:
                try:
                    write_res = await db.write_wiki_page(
                        path=node.path,
                        content=upd.content,
                        written_by="wiki_agent",
                        rationale=upd.rationale,
                    )
                    log.info(
                        "orchestrator: fallback write for %s (rev=%d, unchanged=%s)",
                        node.path, write_res.revision, write_res.unchanged,
                    )
                    if write_res.unchanged:
                        result.unchanged += 1
                    else:
                        result.updated += 1
                except ValueError as e:
                    log.error("orchestrator: refused write for %s: %s", node.path, e)
                    result.failed += 1
                    result.details.append({"path": node.path, "status": "rejected", "error": str(e)})
                    return
            else:
                # Agent wrote (or dry-run). Count it as updated for reporting.
                result.updated += 1

            result.details.append({
                "path": node.path,
                "status": "updated",
                "rationale": upd.rationale,
            })

        # Phase A: depth-3 in parallel batches
        batch_size = max(1, wiki_cfg.max_concurrent)
        for i in range(0, len(depth3), batch_size):
            batch = depth3[i : i + batch_size]
            await asyncio.gather(*[_process(n) for n in batch])

        # Phase B: depth-2 sequentially
        for node in depth2:
            await _process(node)

        # Phase C: depth-1 (user.md)
        for node in depth1:
            await _process(node)

    log.info(
        "wiki done: updated=%d unchanged=%d failed=%d",
        result.updated,
        result.unchanged,
        result.failed,
    )
    return result
