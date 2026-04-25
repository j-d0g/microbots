"""DB-level tests for the wiki layer (wiki_page / wiki_page_revision).

Uses the ephemeral test_db fixture, which already applies schema/02_wiki.surql
and schema/04_wiki_seed.surql, so the 18-page skeleton is present.
"""
from __future__ import annotations

import pytest

from db.client import MicrobotsDB

EXPECTED_PATHS = sorted([
    "user.md",
    "integrations/agents.md",
    "entities/agents.md",
    "chats/agents.md",
    "memories/agents.md",
    "skills/agents.md",
    "workflows/agents.md",
    "integrations/github/agents.md",
    "integrations/gmail/agents.md",
    "integrations/linear/agents.md",
    "integrations/notion/agents.md",
    "integrations/perplexity/agents.md",
    "integrations/slack/agents.md",
    "entities/person/agents.md",
    "entities/channel/agents.md",
    "entities/repo/agents.md",
    "entities/project/agents.md",
    "entities/team/agents.md",
])


@pytest.fixture
def db(test_db) -> MicrobotsDB:
    return MicrobotsDB(test_db)


@pytest.mark.asyncio
async def test_skeleton_has_18_pages(db):
    tree = await db.list_wiki_tree()
    assert len(tree) == 18
    paths = sorted(n.path for n in tree)
    assert paths == EXPECTED_PATHS


@pytest.mark.asyncio
async def test_skeleton_starts_empty(db):
    for path in EXPECTED_PATHS:
        page = await db.get_wiki_page(path)
        assert page is not None
        assert page.content == ""
        assert page.token_estimate == 0
        assert page.revision == 0


@pytest.mark.asyncio
async def test_skeleton_parent_edges_correct(db):
    tree = await db.list_wiki_tree()
    by_path = {n.path: n for n in tree}

    # Root has no parent
    assert by_path["user.md"].parent_path is None

    # Depth-2 layer pages → user.md
    for layer in ("integrations", "entities", "chats", "memories", "skills", "workflows"):
        node = by_path[f"{layer}/agents.md"]
        assert node.parent_path == "user.md", f"{layer} should have user.md as parent"

    # Depth-3 integration pages → integrations/agents.md
    for slug in ("slack", "github", "linear", "gmail", "notion", "perplexity"):
        node = by_path[f"integrations/{slug}/agents.md"]
        assert node.parent_path == "integrations/agents.md"

    # Depth-3 entity-type pages → entities/agents.md
    for etype in ("person", "channel", "repo", "project", "team"):
        node = by_path[f"entities/{etype}/agents.md"]
        assert node.parent_path == "entities/agents.md"


@pytest.mark.asyncio
async def test_write_creates_revision(db):
    r1 = await db.write_wiki_page("user.md", "# v1", rationale="first")
    assert r1.unchanged is False
    assert r1.revision == 1

    page = await db.get_wiki_page("user.md")
    assert page.content == "# v1"
    assert page.revision == 1
    assert page.token_estimate > 0


@pytest.mark.asyncio
async def test_write_idempotent_on_hash_match(db):
    await db.write_wiki_page("user.md", "# v1", rationale="first")
    r2 = await db.write_wiki_page("user.md", "# v1", rationale="dup")
    assert r2.unchanged is True
    assert r2.revision == 1  # no bump


@pytest.mark.asyncio
async def test_write_archives_prior_content(db):
    await db.write_wiki_page("user.md", "# v1")
    await db.write_wiki_page("user.md", "# v2")
    revs = await db.get_wiki_revisions("user.md")
    # Only v1 archived (v2 is current)
    assert len(revs) == 1
    assert revs[0].content == "# v1"
    assert revs[0].revision == 1


@pytest.mark.asyncio
async def test_write_rejects_unknown_path(db):
    with pytest.raises(ValueError, match="does not exist"):
        await db.write_wiki_page("nonexistent/agents.md", "x")


@pytest.mark.asyncio
async def test_revision_trim_keeps_n(db):
    # Write 12 distinct contents → 11 archived + 1 current.
    for i in range(12):
        await db.write_wiki_page("user.md", f"# v{i}")
    revs = await db.get_wiki_revisions("user.md", limit=20)
    # keep_revisions=10 by default, so we keep the most recent 10 archived.
    assert len(revs) <= 10


@pytest.mark.asyncio
async def test_reset_wiki_blanks_all_content(db):
    await db.write_wiki_page("user.md", "# v1")
    await db.write_wiki_page("integrations/slack/agents.md", "slack content")

    n = await db.reset_wiki()
    assert n == 18

    page = await db.get_wiki_page("user.md")
    assert page.content == ""
    assert page.token_estimate == 0
    assert page.updated_by == "reset"
    page2 = await db.get_wiki_page("integrations/slack/agents.md")
    assert page2.content == ""
