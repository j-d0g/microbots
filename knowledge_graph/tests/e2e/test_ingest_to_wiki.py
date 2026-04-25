"""End-to-end tests: seed graph → wiki agent → wiki_page rows in SurrealDB.

The wiki layer is now stored as `wiki_page` rows (see plan: wiki_in_surrealdb_v1).
Composio and LLM triage are bypassed entirely. The tests:
  1. Seed the ephemeral DB with realistic data (seed/seed.py::seed)
  2. Run the wiki agent against the seeded graph
  3. Assert that wiki_page.content is non-empty for every expected path

Requires a running SurrealDB instance (docker compose up -d).
The live-LLM test is skipped when no OPENROUTER_API_KEY / ANTHROPIC_API_KEY is set.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent  # = knowledge_graph/

_HAS_LLM_KEY = bool(
    os.getenv("OPENROUTER_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
)

INTEGRATIONS = ["slack", "github", "linear", "gmail", "notion", "perplexity"]
LAYERS = ("integrations", "entities", "chats", "memories", "skills", "workflows")
ENTITY_TYPES = ("person", "channel", "repo", "project", "team")

EXPECTED_PATHS = [
    "user.md",
    *[f"{layer}/agents.md" for layer in LAYERS],
    *[f"integrations/{intg}/agents.md" for intg in INTEGRATIONS],
    *[f"entities/{etype}/agents.md" for etype in ENTITY_TYPES],
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _count(db, table: str) -> int:
    res = await db.query(f"SELECT count() AS n FROM {table} GROUP ALL")
    rows = res if isinstance(res, list) else [res]
    for r in rows:
        if isinstance(r, dict) and "n" in r:
            return int(r["n"])
    return 0


def _preflight_llm_auth() -> None:
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    if openrouter_key and openrouter_key.startswith("sk-or-"):
        return
    if anthropic_key and anthropic_key.startswith("sk-ant-"):
        return
    if openrouter_key or anthropic_key:
        pytest.skip(
            "LLM key present but format looks invalid. "
            "OPENROUTER_API_KEY must start with 'sk-or-', ANTHROPIC_API_KEY with 'sk-ant-'."
        )
    pytest.skip("No LLM key set (OPENROUTER_API_KEY or ANTHROPIC_API_KEY).")


# ---------------------------------------------------------------------------
# Test 1: Seeded graph node counts (no LLM)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
async def test_seed_populates_graph(test_db):
    from seed.seed import seed
    await seed(test_db)

    assert await _count(test_db, "user_profile") >= 1
    assert await _count(test_db, "integration") == 6
    assert await _count(test_db, "entity") >= 10
    assert await _count(test_db, "chat") >= 6
    assert await _count(test_db, "memory") >= 6
    assert await _count(test_db, "skill") == 4
    assert await _count(test_db, "workflow") == 3


# ---------------------------------------------------------------------------
# Test 2: Wiki skeleton invariants (no LLM)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
async def test_wiki_skeleton_present_after_schema(test_db):
    """schema/04_wiki_seed.surql gives us 18 wiki_page rows + 17 parent edges."""
    from db.client import MicrobotsDB
    db = MicrobotsDB(test_db)
    tree = await db.list_wiki_tree()
    assert len(tree) == 18

    paths = {n.path for n in tree}
    assert paths == set(EXPECTED_PATHS), (
        f"unexpected wiki paths: missing={set(EXPECTED_PATHS) - paths}, "
        f"extra={paths - set(EXPECTED_PATHS)}"
    )

    # All start empty
    for node in tree:
        page = await db.get_wiki_page(node.path)
        assert page.content == ""
        assert page.revision == 0

    # 17 parent edges (every non-root has exactly one parent)
    edges = await _count(test_db, "wiki_parent")
    assert edges == 17


# ---------------------------------------------------------------------------
# Test 3: Full pipeline writes to DB (requires LLM key)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
@pytest.mark.live_llm
async def test_wiki_writes_all_pages_to_db(test_db, test_db_config):
    """Seed → wiki agent → every wiki_page.content is non-empty in the DB."""
    if not _HAS_LLM_KEY:
        pytest.skip("No LLM key set")
    _preflight_llm_auth()

    from seed.seed import seed
    from db.client import MicrobotsDB
    from wiki.orchestrator import run_wiki

    await seed(test_db)
    db = MicrobotsDB(test_db)

    result = await run_wiki(test_db_config)

    assert result.failed == 0, (
        f"Wiki failed on {result.failed} page(s): "
        + str([d for d in result.details if d.get("status") in ("failed", "rejected")])
    )

    # Every expected page must now have non-empty content in the DB.
    for path in EXPECTED_PATHS:
        page = await db.get_wiki_page(path)
        assert page is not None, f"missing wiki_page row for {path}"
        assert page.content, f"empty wiki_page.content for {path}"
        assert page.revision >= 1, f"wiki_page revision not bumped for {path}"
        assert page.updated_by == "wiki_agent", (
            f"wiki_page.updated_by={page.updated_by!r} for {path} (expected wiki_agent)"
        )

    print(f"\nWiki wrote {result.updated} page(s) to DB:")
    for path in EXPECTED_PATHS:
        page = await db.get_wiki_page(path)
        print(f"  {path:<46} rev={page.revision} bytes={len(page.content):>5}")


# ---------------------------------------------------------------------------
# Test 4: Idempotency at the DB level (re-running with same graph adds no revisions)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
@pytest.mark.live_llm
async def test_wiki_run_idempotent_at_db_level(test_db, test_db_config):
    """Running the wiki agent twice on the same graph state should not bump revisions
    further than the second-pass content might warrant — at minimum, no failures and
    every page still has a valid revision.

    NOTE: LLMs are non-deterministic, so we don't assert *exact* revision equality;
    we only assert the second run completes and every page remains non-empty.
    """
    if not _HAS_LLM_KEY:
        pytest.skip("No LLM key set")
    _preflight_llm_auth()

    from seed.seed import seed
    from db.client import MicrobotsDB
    from wiki.orchestrator import run_wiki

    await seed(test_db)
    db = MicrobotsDB(test_db)

    r1 = await run_wiki(test_db_config)
    assert r1.failed == 0
    revs_after_first = {p: (await db.get_wiki_page(p)).revision for p in EXPECTED_PATHS}

    r2 = await run_wiki(test_db_config)
    assert r2.failed == 0
    revs_after_second = {p: (await db.get_wiki_page(p)).revision for p in EXPECTED_PATHS}

    # Every page must still have a non-empty body and a revision >= the first
    # run's revision. LLMs are non-deterministic, so we don't enforce equality;
    # we only assert "no regressions" — the second run never blanks a page or
    # rolls back its revision counter.
    for path in EXPECTED_PATHS:
        assert revs_after_second[path] >= revs_after_first[path], (
            f"{path}: revision rolled back rev1={revs_after_first[path]} "
            f"rev2={revs_after_second[path]}"
        )
        page = await db.get_wiki_page(path)
        assert page.content, f"{path}: content went empty on second run"


# ---------------------------------------------------------------------------
# Test 5: Edge invariants on seeded graph (no LLM)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
async def test_seed_edge_invariants(test_db):
    from seed.seed import seed
    await seed(test_db)

    chat_count = await _count(test_db, "chat")
    chat_from_count = await _count(test_db, "chat_from")
    assert chat_from_count >= chat_count

    memory_count = await _count(test_db, "memory")
    chat_yields_count = await _count(test_db, "chat_yields")
    assert chat_yields_count >= memory_count

    skill_count = await _count(test_db, "skill")
    skill_derived_count = await _count(test_db, "skill_derived_from")
    assert skill_derived_count >= skill_count

    workflow_count = await _count(test_db, "workflow")
    wf_skill_count = await _count(test_db, "workflow_contains_skill")
    assert wf_skill_count >= workflow_count * 2


# ---------------------------------------------------------------------------
# Test 6: corpus_meta.json sanity (no LLM, no DB)
# ---------------------------------------------------------------------------

def test_corpus_meta_annotations():
    corpus_meta = ROOT / "tests" / "fixtures" / "corpus_meta.json"
    if not corpus_meta.exists():
        pytest.skip("No corpus_meta.json (run make synth-corpus first)")
    import json
    meta = json.loads(corpus_meta.read_text())
    assert "expected_entities" in meta
    assert "expected_skills" in meta
    assert "expected_workflows" in meta
