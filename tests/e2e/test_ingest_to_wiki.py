"""End-to-end tests: seed graph → wiki agent → memory/ markdown files.

Composio and LLM triage are bypassed entirely. The tests:
  1. Seed the ephemeral DB with realistic data (seed/seed.py::seed)
  2. Run the wiki agent against the seeded graph
  3. Assert that markdown files are written with correct content

Requires a running SurrealDB instance (docker compose up -d).
Requires at least one LLM API key (OPENROUTER_API_KEY or ANTHROPIC_API_KEY).
Tests marked @pytest.mark.live_llm make real LLM calls and are skipped when no key is set.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent

# Whether an LLM key is available in the environment
_HAS_LLM_KEY = bool(
    os.getenv("OPENROUTER_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
)

INTEGRATIONS = ["slack", "github", "linear", "gmail", "notion", "perplexity"]
LAYERS = ("integrations", "entities", "chats", "memories", "skills", "workflows")


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


def _md_files(memory_root: Path) -> list[Path]:
    return sorted(memory_root.rglob("*.md"))


# ---------------------------------------------------------------------------
# Test 1: Seed → derive targets — no LLM key needed
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
async def test_seed_populates_graph(test_db, memory_root):
    """Seed data populates expected node counts in the ephemeral DB."""
    from seed.seed import seed

    await seed(test_db)

    assert await _count(test_db, "user_profile") >= 1
    assert await _count(test_db, "integration") == 6
    assert await _count(test_db, "entity") >= 10
    assert await _count(test_db, "chat") >= 6
    assert await _count(test_db, "memory") >= 6
    assert await _count(test_db, "skill") == 4
    assert await _count(test_db, "workflow") == 3


@pytest.mark.asyncio
@pytest.mark.e2e
async def test_seed_derives_all_wiki_targets(test_db, memory_root):
    """After seeding, derive_targets returns the full expected set of paths."""
    from seed.seed import seed
    from db.client import MicrobotsDB
    from wiki.targets import derive_targets

    await seed(test_db)
    wrapped_db = MicrobotsDB(test_db)
    targets = await derive_targets(wrapped_db, memory_root)

    paths = [str(t.path.relative_to(memory_root)) for t in targets]

    # user.md must be last (depth 1)
    assert paths[-1] == "user.md", f"Expected user.md last, got: {paths[-1]}"

    # All 6 integration sub-layers (depth 3)
    for intg in INTEGRATIONS:
        assert f"integrations/{intg}/agents.md" in paths, f"Missing: integrations/{intg}/agents.md"

    # All 6 layer-level agents.md (depth 2)
    for layer in LAYERS:
        assert f"{layer}/agents.md" in paths, f"Missing: {layer}/agents.md"

    # Should have entity type sub-layers too (person, channel, repo, project, team from seed)
    entity_targets = [p for p in paths if p.startswith("entities/") and p != "entities/agents.md"]
    assert len(entity_targets) >= 1, "Expected at least one entity type sub-layer"

    print(f"\nDerived {len(targets)} targets: {paths}")


# ---------------------------------------------------------------------------
# Test 2: Full wiki pipeline writes markdown files (requires LLM key)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
@pytest.mark.live_llm
async def test_wiki_writes_all_markdown_files(test_db, test_db_config, memory_root):
    """Seed → wiki agent → all expected markdown files exist and are non-empty."""
    if not _HAS_LLM_KEY:
        pytest.skip("No LLM API key set (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)")

    from seed.seed import seed
    from wiki.orchestrator import run_wiki

    await seed(test_db)

    # test_db_config is wired to the same ephemeral DB as test_db
    result = await run_wiki(test_db_config, memory_root=memory_root)

    assert result.failed == 0, (
        f"Wiki failed on {result.failed} file(s): "
        + str([d for d in result.details if d.get("status") == "failed"])
    )
    assert result.updated > 0, "Wiki agent wrote no files"

    # Every expected path must exist and be non-empty
    expected_paths = (
        [memory_root / "user.md"]
        + [memory_root / layer / "agents.md" for layer in LAYERS]
        + [memory_root / "integrations" / intg / "agents.md" for intg in INTEGRATIONS]
    )
    for p in expected_paths:
        assert p.exists(), f"Missing markdown file: {p.relative_to(memory_root)}"
        assert p.stat().st_size > 0, f"Empty markdown file: {p.relative_to(memory_root)}"

    print(f"\nWiki wrote {result.updated} file(s). Files on disk:")
    for f in _md_files(memory_root):
        print(f"  {f.relative_to(memory_root)} ({f.stat().st_size} bytes)")


# ---------------------------------------------------------------------------
# Test 3: Wiki idempotency — same targets on identical DB state (no LLM)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
async def test_wiki_target_idempotency(test_db, memory_root):
    """Running derive_targets twice on the same DB returns the same ordered list."""
    from seed.seed import seed
    from db.client import MicrobotsDB
    from wiki.targets import derive_targets

    await seed(test_db)
    wrapped_db = MicrobotsDB(test_db)

    targets1 = await derive_targets(wrapped_db, memory_root)
    targets2 = await derive_targets(wrapped_db, memory_root)

    paths1 = [str(t.path) for t in targets1]
    paths2 = [str(t.path) for t in targets2]
    assert paths1 == paths2, "Target list changed between identical runs"


# ---------------------------------------------------------------------------
# Test 4: Graph invariants after seeding
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.e2e
async def test_seed_edge_invariants(test_db, memory_root):
    """Seeded edges satisfy key structural invariants."""
    from seed.seed import seed

    await seed(test_db)

    # Every chat must have a chat_from edge
    chat_count = await _count(test_db, "chat")
    chat_from_count = await _count(test_db, "chat_from")
    assert chat_from_count >= chat_count, (
        f"chat_from edges ({chat_from_count}) < chat nodes ({chat_count})"
    )

    # Every memory must have at least one chat_yields edge pointing to it
    memory_count = await _count(test_db, "memory")
    chat_yields_count = await _count(test_db, "chat_yields")
    assert chat_yields_count >= memory_count, (
        f"chat_yields edges ({chat_yields_count}) < memory nodes ({memory_count})"
    )

    # All 4 skills must have skill_derived_from edges
    skill_count = await _count(test_db, "skill")
    skill_derived_count = await _count(test_db, "skill_derived_from")
    assert skill_derived_count >= skill_count, (
        f"skill_derived_from edges ({skill_derived_count}) < skill nodes ({skill_count})"
    )

    # All 3 workflows must have workflow_contains_skill edges (≥ 2 skills each)
    workflow_count = await _count(test_db, "workflow")
    wf_skill_count = await _count(test_db, "workflow_contains_skill")
    assert wf_skill_count >= workflow_count * 2, (
        f"workflow_contains_skill edges ({wf_skill_count}) too few for {workflow_count} workflows"
    )


# ---------------------------------------------------------------------------
# Test 5: corpus_meta.json annotations
# ---------------------------------------------------------------------------

def test_corpus_meta_annotations():
    """corpus_meta.json exists and has the expected annotation keys."""
    corpus_meta = ROOT / "tests" / "fixtures" / "corpus_meta.json"
    if not corpus_meta.exists():
        pytest.skip("No corpus_meta.json found (run make synth-corpus first)")

    import json
    meta = json.loads(corpus_meta.read_text())
    assert "expected_entities" in meta
    assert "expected_skills" in meta
    assert "expected_workflows" in meta
    assert isinstance(meta["expected_entities"], list)
