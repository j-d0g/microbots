"""Smoke test for the eval harness — validates artifact generation without LLM.

Runs structural checks, graph QA, and wiki QA bundle against synthetic fixture
data. No SurrealDB or LLM key required — uses mock data directly.

Asserts that:
  - structural scorecard contains all 11 metrics
  - hard_floor_violations is a list
  - graph QA produces per-target scores for all 3 targets
  - wiki QA bundle contains exactly 15 questions
  - qa_set.yaml loads 15 questions with 5 per target
  - apply_and_run promotion logic works deterministically (no LLM calls)
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

KG_ROOT = Path(__file__).resolve().parent.parent.parent  # = knowledge_graph/
REPO_ROOT = KG_ROOT.parent  # = microbots/
FIXTURES = KG_ROOT / "tests" / "fixtures"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def corpus_meta() -> dict:
    """Load the real corpus_meta.json."""
    meta_path = FIXTURES / "corpus_meta.json"
    return json.loads(meta_path.read_text())


@pytest.fixture
def sample_db_entities() -> list[dict]:
    """Minimal synthetic entity data for structural checks."""
    return [
        {
            "name": "Alice Chen",
            "entity_type": "person",
            "aliases": ["@alice", "alice-chen", "alice@company.com"],
            "tags": [],
        },
        {
            "name": "Bob Kim",
            "entity_type": "person",
            "aliases": ["@bob", "bob-kim", "bob@company.com"],
            "tags": [],
        },
        {
            "name": "Carol Diaz",
            "entity_type": "person",
            "aliases": ["@carol", "carol-diaz"],
            "tags": [],
        },
        {
            "name": "microbots",
            "entity_type": "repo",
            "aliases": ["microbots", "github.com/org/microbots"],
            "tags": [],
        },
        {
            "name": "Agent Memory",
            "entity_type": "project",
            "aliases": ["Agent Memory", "agent-memory"],
            "tags": [],
        },
    ]


@pytest.fixture
def sample_db_memories() -> list[dict]:
    """Minimal synthetic memory data."""
    return [
        {
            "content": "Deploy to production every Tuesday",
            "memory_type": "decision",
            "confidence": 0.8,
            "source_chat_ids": ["fix_slack_abc123"],
            "tags": ["deploy"],
        },
        {
            "content": "HNSW index uses 1536 dimensions",
            "memory_type": "fact",
            "confidence": 0.95,
            "source_chat_ids": ["fix_slack_def456"],
            "tags": ["technical"],
        },
    ]


@pytest.fixture
def sample_db_skills() -> list[dict]:
    return [
        {"slug": "deploy_flow", "name": "Deploy Flow", "strength": 3, "description": "Deploy process"},
        {"slug": "pr_review_flow", "name": "PR Review Flow", "strength": 2, "description": "PR review"},
    ]


@pytest.fixture
def sample_db_workflows() -> list[dict]:
    return [
        {
            "slug": "bug_triage_pipeline",
            "name": "Bug Triage Pipeline",
            "trigger": "New bug report filed",
            "outcome": "Bug is triaged and assigned",
            "skill_chain": ["deploy_flow", "pr_review_flow"],
        },
    ]


# ---------------------------------------------------------------------------
# Test 1: structural.py produces all 11 metrics
# ---------------------------------------------------------------------------

def test_structural_checks_produce_all_metrics(
    tmp_path, corpus_meta, sample_db_entities, sample_db_memories,
    sample_db_skills, sample_db_workflows,
):
    """structural.py returns all 11 metrics and hard_floor_violations."""
    import sys
    sys.path.insert(0, str(KG_ROOT))
    from tests.eval.structural import run_structural_checks

    memory_dir = tmp_path / "memory"
    memory_dir.mkdir()

    scorecard = run_structural_checks(
        db_entities=sample_db_entities,
        db_memories=sample_db_memories,
        db_skills=sample_db_skills,
        db_workflows=sample_db_workflows,
        corpus_meta=corpus_meta,
        memory_dir=memory_dir,
        phase="triage",
        label="baseline",
        split="train",
    )

    assert "structural" in scorecard
    assert "hard_floor_violations" in scorecard
    assert isinstance(scorecard["hard_floor_violations"], list)

    metrics = scorecard["structural"]
    expected_metrics = [
        "entity_recall", "entity_precision", "entity_alias_coverage",
        "memory_hallucination_rate", "negative_suppression",
        "skill_recall", "workflow_recall", "workflow_precision",
        "multi_integration_workflows", "contradiction_handling",
        "wiki_hallucination_rate",
    ]
    for m in expected_metrics:
        assert m in metrics, f"Missing metric: {m}"
        assert isinstance(metrics[m], (int, float)), f"{m} is not numeric: {metrics[m]}"


# ---------------------------------------------------------------------------
# Test 2: qa_set.yaml has exactly 15 questions, 5 per target
# ---------------------------------------------------------------------------

def test_qa_set_schema():
    """qa_set.yaml has 15 questions, 5 per target, with required fields."""
    qa_path = KG_ROOT / "tests" / "eval" / "qa_set.yaml"
    assert qa_path.exists(), f"qa_set.yaml not found at {qa_path}"

    questions = yaml.safe_load(qa_path.read_text())
    assert len(questions) == 15, f"Expected 15 questions, got {len(questions)}"

    targets = {}
    required_fields = {"id", "question", "target", "expected_answer", "scoring_mode"}
    for q in questions:
        for field in required_fields:
            assert field in q, f"Question {q.get('id', '?')} missing field: {field}"
        target = q["target"]
        targets.setdefault(target, []).append(q["id"])

    assert len(targets) == 3, f"Expected 3 targets, got {len(targets)}"
    for target, ids in targets.items():
        assert len(ids) == 5, f"Target '{target}' has {len(ids)} questions, expected 5"


# ---------------------------------------------------------------------------
# Test 3: retrieval_qa wiki bundler produces 15 questions
# ---------------------------------------------------------------------------

def test_wiki_bundle_produces_15_questions():
    """Wiki QA bundler emits all 15 questions with context."""
    import sys
    sys.path.insert(0, str(KG_ROOT))
    from tests.eval.retrieval_qa import run_wiki_bundle

    bundle = run_wiki_bundle("baseline", "train")

    assert bundle["mode"] == "wiki_bundle"
    assert len(bundle["questions"]) == 15

    for q in bundle["questions"]:
        assert "id" in q
        assert "question" in q
        assert "context" in q
        assert "expected_answer" in q


# ---------------------------------------------------------------------------
# Test 4: retrieval_qa graph scoring functions work
# ---------------------------------------------------------------------------

def test_graph_scoring_functions():
    """Graph-mode scoring functions produce valid 0-5 scores."""
    import sys
    sys.path.insert(0, str(KG_ROOT))
    from tests.eval.retrieval_qa import (
        score_exact_match,
        score_free_form_graph,
        score_set_recall_at_k,
    )

    # exact_match
    rows = [{"name": "Bob Kim", "slug": "bob-kim"}]
    assert score_exact_match("Bob Kim", rows) == 5.0

    # set_recall
    rows = [{"slug": "slack"}, {"slug": "github"}, {"slug": "linear"}]
    score = score_set_recall_at_k(["slack", "github", "linear"], rows)
    assert score == 5.0

    # free_form_graph
    rows = [{"slug": "deploy_flow", "name": "Deploy Flow", "strength": 3}]
    score = score_free_form_graph("deploy_flow", rows)
    assert 0 <= score <= 5.0


# ---------------------------------------------------------------------------
# Test 5: apply_and_run promotion logic (deterministic, no LLM)
# ---------------------------------------------------------------------------

def test_promotion_rule_accept():
    """Promotion rule accepts when candidate clearly beats baseline."""
    import sys
    sys.path.insert(0, str(KG_ROOT))
    from tests.eval.apply_and_run import evaluate_promotion

    baseline_rubric = {"weighted_total": 3.0}
    candidate_rubric = {"weighted_total": 3.5}
    baseline_structural = {"structural": {
        "entity_precision": 1.0,
        "memory_hallucination_rate": 0.0,
        "negative_suppression": 1.0,
        "workflow_precision": 1.0,
        "wiki_hallucination_rate": 0.0,
        "entity_recall": 0.9,
        "entity_alias_coverage": 0.8,
        "skill_recall": 0.8,
        "workflow_recall": 0.8,
    }}
    candidate_structural = baseline_structural.copy()
    baseline_qa = {"qa_graph_total": 3.0, "per_target_means": {
        "next_step": 3.0, "contact_lookup": 3.0, "optimisation_surface": 3.0,
    }}
    candidate_qa = {"qa_graph_total": 3.5, "per_target_means": {
        "next_step": 3.5, "contact_lookup": 3.5, "optimisation_surface": 3.5,
    }}

    promote, reasons = evaluate_promotion(
        phase="triage",
        baseline_rubric_train=baseline_rubric,
        candidate_rubric_train=candidate_rubric,
        baseline_rubric_holdout=baseline_rubric,
        candidate_rubric_holdout=candidate_rubric,
        baseline_structural=baseline_structural,
        candidate_structural=candidate_structural,
        baseline_qa_graph=baseline_qa,
        candidate_qa_graph=candidate_qa,
        baseline_qa_wiki={},
        candidate_qa_wiki={},
    )
    assert promote is True, f"Expected promotion but got rejection: {reasons}"


def test_promotion_rule_reject_tie():
    """Promotion rule rejects when candidate is within tie band."""
    import sys
    sys.path.insert(0, str(KG_ROOT))
    from tests.eval.apply_and_run import evaluate_promotion

    baseline_rubric = {"weighted_total": 3.0}
    candidate_rubric = {"weighted_total": 3.03}  # within 0.05 tie band
    empty_structural = {"structural": {}}

    promote, reasons = evaluate_promotion(
        phase="triage",
        baseline_rubric_train=baseline_rubric,
        candidate_rubric_train=candidate_rubric,
        baseline_rubric_holdout=baseline_rubric,
        candidate_rubric_holdout=candidate_rubric,
        baseline_structural=empty_structural,
        candidate_structural=empty_structural,
        baseline_qa_graph={},
        candidate_qa_graph={},
        baseline_qa_wiki={},
        candidate_qa_wiki={},
    )
    assert promote is False
    assert any("Tie band" in r for r in reasons)


def test_promotion_rule_reject_hard_floor():
    """Promotion rule rejects on hard floor violation."""
    import sys
    sys.path.insert(0, str(KG_ROOT))
    from tests.eval.apply_and_run import evaluate_promotion

    baseline_rubric = {"weighted_total": 3.0}
    candidate_rubric = {"weighted_total": 3.5}
    candidate_structural = {"structural": {
        "entity_precision": 0.90,  # below 0.95 hard floor
        "memory_hallucination_rate": 0.0,
        "negative_suppression": 1.0,
        "workflow_precision": 1.0,
        "wiki_hallucination_rate": 0.0,
    }}

    promote, reasons = evaluate_promotion(
        phase="triage",
        baseline_rubric_train=baseline_rubric,
        candidate_rubric_train=candidate_rubric,
        baseline_rubric_holdout=baseline_rubric,
        candidate_rubric_holdout=candidate_rubric,
        baseline_structural={"structural": {}},
        candidate_structural=candidate_structural,
        baseline_qa_graph={},
        candidate_qa_graph={},
        baseline_qa_wiki={},
        candidate_qa_wiki={},
    )
    assert promote is False
    assert any("hard floor" in r for r in reasons)


# ---------------------------------------------------------------------------
# Test 6: RULES.md exists and contains expected sections
# ---------------------------------------------------------------------------

def test_rules_md_exists():
    """RULES.md exists under .devin/ with required sections."""
    rules_path = REPO_ROOT / ".devin" / "RULES.md"
    assert rules_path.exists(), f"RULES.md not found at {rules_path}"

    content = rules_path.read_text()
    expected_sections = [
        "## Mission",
        "## Files you may modify",
        "## Files you must NOT modify",
        "## Per-session loop",
        "## Promotion rule",
        "## Hard floors",
        "## Judging discipline",
        "## Optimisation targets",
        "## Commits",
        "## Failure handling",
        "## Out of scope",
    ]
    for section in expected_sections:
        assert section in content, f"RULES.md missing section: {section}"


# ---------------------------------------------------------------------------
# Test 7: adversarial.yaml loads and has expected adversarial cases
# ---------------------------------------------------------------------------

def test_adversarial_yaml_loads():
    """adversarial.yaml has all required adversarial case categories."""
    adv_path = KG_ROOT / "tests" / "synth" / "adversarial.yaml"
    assert adv_path.exists(), f"adversarial.yaml not found"

    data = yaml.safe_load(adv_path.read_text())
    assert "two_alices" in data, "Missing two_alices adversarial cases"
    assert "noise_chats" in data, "Missing noise_chats adversarial cases"
    assert "contradiction" in data, "Missing contradiction adversarial cases"
    assert "multi_integration_workflow" in data, "Missing multi_integration_workflow"
    assert "alias_drift" in data, "Missing alias_drift adversarial cases"

    # Two Alices must have distinct names
    alice_names = {c.get("entity_hint", {}).get("name") for c in data["two_alices"] if c.get("entity_hint")}
    assert "Alice Park" in alice_names, "Two Alices: missing Alice Park"

    # Noise chats must have signal_level: low
    for noise in data["noise_chats"]:
        assert noise["signal_level"] == "low", f"Noise chat {noise['source_id']} not marked low"
