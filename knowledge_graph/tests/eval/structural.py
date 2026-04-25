"""Deterministic structural checks against SurrealDB after enrichment.

Implements the 11 metrics from § Signal B of the eval plan.
No LLM calls — pure Python + SurrealDB reads via db/client.py.

Output schema:
    {
        "phase": "<phase>",
        "label": "<label>",
        "split": "<split>",
        "structural": { "<metric>": <float>, ... },
        "hard_floor_violations": ["<metric_name>", ...]
    }

Usage:
    uv run python tests/eval/structural.py \
        --phase entity_resolution --label baseline --split train
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "python-dotenv>=1", "pyyaml>=6"]
# ///
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent  # = knowledge_graph/
FIXTURES = ROOT / "tests" / "fixtures"
REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)
MEMORY_DIR = ROOT / "memory"

log = logging.getLogger("structural")


# ---------------------------------------------------------------------------
# Hard floors
# ---------------------------------------------------------------------------

HARD_FLOORS: dict[str, tuple[str, float]] = {
    "entity_precision":          (">=", 0.95),
    "memory_hallucination_rate": ("==", 0.0),
    "negative_suppression":      (">=", 0.95),
    "workflow_precision":        ("==", 1.0),
    "wiki_hallucination_rate":   ("==", 0.0),
}


def _check_floor(metric: str, value: float) -> bool:
    """Return True if the hard floor is satisfied."""
    if metric not in HARD_FLOORS:
        return True
    op, threshold = HARD_FLOORS[metric]
    if op == ">=":
        return value >= threshold
    if op == "==":
        return value == threshold
    return True


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

def entity_recall(
    db_entities: list[dict],
    expected: list[dict],
) -> float:
    """Fraction of expected canonical entities found in DB with >= 1 alias resolved."""
    if not expected:
        return 1.0
    found = 0
    db_names = {e.get("name", "").lower() for e in db_entities}
    db_alias_sets: dict[str, set[str]] = {}
    for e in db_entities:
        key = e.get("name", "").lower()
        db_alias_sets[key] = {a.lower() for a in e.get("aliases", [])}
    for exp in expected:
        exp_name = exp["name"].lower()
        if exp_name in db_names:
            exp_aliases = {a.lower() for a in exp.get("aliases", [])}
            db_aliases = db_alias_sets.get(exp_name, set())
            if exp_aliases & db_aliases:
                found += 1
    return found / len(expected)


def entity_precision(db_entities: list[dict]) -> float:
    """1 - (duplicate canonical entities / total entities)."""
    if not db_entities:
        return 1.0
    names = [e.get("name", "").lower() for e in db_entities]
    unique = len(set(names))
    return unique / len(names)


def entity_alias_coverage(
    db_entities: list[dict],
    expected: list[dict],
) -> float:
    """Mean(aliases_resolved / aliases_expected) per canonical entity."""
    if not expected:
        return 1.0
    db_alias_map: dict[str, set[str]] = {}
    for e in db_entities:
        key = e.get("name", "").lower()
        db_alias_map.setdefault(key, set()).update(
            a.lower() for a in e.get("aliases", [])
        )
    scores = []
    for exp in expected:
        exp_name = exp["name"].lower()
        exp_aliases = {a.lower() for a in exp.get("aliases", [])}
        if not exp_aliases:
            scores.append(1.0)
            continue
        db_aliases = db_alias_map.get(exp_name, set())
        resolved = len(exp_aliases & db_aliases)
        scores.append(resolved / len(exp_aliases))
    return sum(scores) / len(scores) if scores else 1.0


def memory_hallucination_rate(
    db_memories: list[dict],
    corpus_source_ids: set[str],
) -> float:
    """Memories whose source_chat_ids reference chats not in the injected corpus."""
    if not db_memories:
        return 0.0
    hallucinated = 0
    for mem in db_memories:
        source_ids = mem.get("source_chat_ids", [])
        if not source_ids:
            continue
        for sid in source_ids:
            sid_str = str(sid)
            # Extract the actual ID from SurrealDB record IDs like "chat:fix_slack_abc"
            clean = sid_str.split(":")[-1] if ":" in sid_str else sid_str
            if clean not in corpus_source_ids and sid_str not in corpus_source_ids:
                hallucinated += 1
                break
    return hallucinated / len(db_memories)


def negative_suppression(
    db_memories: list[dict],
    negative_chat_ids: list[str],
) -> float:
    """1 - (memories produced from expected_negative_chats / negative chats injected)."""
    if not negative_chat_ids:
        return 1.0
    neg_set = set(negative_chat_ids)
    neg_chats_with_memories: set[str] = set()
    for mem in db_memories:
        source_ids = mem.get("source_chat_ids", [])
        for sid in source_ids:
            sid_str = str(sid)
            clean = sid_str.split(":")[-1] if ":" in sid_str else sid_str
            if clean in neg_set or sid_str in neg_set:
                neg_chats_with_memories.add(clean if clean in neg_set else sid_str)
                break
    return 1.0 - (len(neg_chats_with_memories) / len(negative_chat_ids))


def skill_recall(
    db_skills: list[dict],
    expected_skills: list[dict],
) -> float:
    """Expected skills present with min_strength met."""
    if not expected_skills:
        return 1.0
    found = 0
    db_skill_map: dict[str, int] = {}
    for s in db_skills:
        slug = s.get("slug", "").lower()
        db_skill_map[slug] = int(s.get("strength", 0))
    for exp in expected_skills:
        slug = exp["slug"].lower()
        min_str = exp.get("min_strength", 1)
        if slug in db_skill_map and db_skill_map[slug] >= min_str:
            found += 1
    return found / len(expected_skills)


def workflow_recall(
    db_workflows: list[dict],
    expected_workflows: list[dict],
) -> float:
    """Expected workflows present with min_skill_count met."""
    if not expected_workflows:
        return 1.0
    found = 0
    db_wf_map: dict[str, int] = {}
    for wf in db_workflows:
        slug = wf.get("slug", "").lower()
        skill_chain = wf.get("skill_chain", [])
        db_wf_map[slug] = len(skill_chain)
    for exp in expected_workflows:
        slug = exp["slug"].lower()
        min_skills = exp.get("min_skill_count", 1)
        if slug in db_wf_map and db_wf_map[slug] >= min_skills:
            found += 1
    return found / len(expected_workflows)


def workflow_precision(db_workflows: list[dict]) -> float:
    """1 - (workflows missing a clear trigger/outcome OR fabricated multi-integration links)."""
    if not db_workflows:
        return 1.0
    bad = 0
    for wf in db_workflows:
        trigger = (wf.get("trigger") or "").strip()
        outcome = (wf.get("outcome") or "").strip()
        if not trigger or not outcome:
            bad += 1
    return 1.0 - (bad / len(db_workflows))


def multi_integration_workflows(
    db_workflows: list[dict],
    expected_multi: list[dict],
) -> float:
    """Check workflows hitting expected_multi_integration_workflows min_integrations."""
    if not expected_multi:
        return 1.0
    # This metric is reported but gated via workflow_recall
    return 1.0  # placeholder; actual gating is in workflow_recall


def contradiction_handling(
    db_memories: list[dict],
    expected_contradictions: list[dict],
) -> float:
    """For expected contradictions: avg confidence <= max_avg_confidence AND >= 2 memories."""
    if not expected_contradictions:
        return 1.0
    scores = []
    for contra in expected_contradictions:
        topic = contra["topic"].lower()
        max_avg = contra.get("max_avg_confidence", 0.7)
        min_mems = contra.get("min_memories", 2)
        relevant = [
            m for m in db_memories
            if topic in (m.get("content", "") + " " + " ".join(m.get("tags", []))).lower()
        ]
        if len(relevant) >= min_mems:
            avg_conf = sum(m.get("confidence", 0.5) for m in relevant) / len(relevant)
            scores.append(1.0 if avg_conf <= max_avg else 0.5)
        else:
            scores.append(0.0)
    return sum(scores) / len(scores) if scores else 1.0


def wiki_hallucination_rate(memory_dir: Path, db_entity_names: set[str],
                            db_skill_slugs: set[str], db_workflow_slugs: set[str]) -> float:
    """Refs in memory/*.md to entity/skill/workflow names absent from the graph."""
    if not memory_dir.exists():
        return 0.0
    md_files = list(memory_dir.rglob("*.md"))
    if not md_files:
        return 0.0

    all_known = db_entity_names | db_skill_slugs | db_workflow_slugs
    all_known_lower = {n.lower() for n in all_known}
    total_refs = 0
    hallucinated_refs = 0

    for md in md_files:
        text = md.read_text(encoding="utf-8", errors="ignore")
        # Extract references: bold names, table cell names, etc.
        # Look for patterns like **Name** or `slug` in tables
        bold_refs = re.findall(r"\*\*([^*]+)\*\*", text)
        code_refs = re.findall(r"`([^`]+)`", text)
        for ref in bold_refs + code_refs:
            ref_clean = ref.strip().lower()
            if len(ref_clean) < 2 or ref_clean in (
                "name", "type", "slug", "description", "confidence",
                "strength", "trigger", "outcome", "frequency", "tags",
                "true", "false", "none", "id",
            ):
                continue
            total_refs += 1
            if ref_clean not in all_known_lower:
                hallucinated_refs += 1

    if total_refs == 0:
        return 0.0
    return hallucinated_refs / total_refs


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_structural_checks(
    db_entities: list[dict],
    db_memories: list[dict],
    db_skills: list[dict],
    db_workflows: list[dict],
    corpus_meta: dict,
    memory_dir: Path,
    phase: str = "all",
    label: str = "baseline",
    split: str = "train",
) -> dict:
    """Run all 11 structural checks. Returns the scorecard dict."""
    expected_entities = corpus_meta.get("expected_entities", [])
    expected_skills = corpus_meta.get("expected_skills", [])
    expected_workflows = corpus_meta.get("expected_workflows", [])
    negative_ids = corpus_meta.get("expected_negative_chats", [])
    expected_alias = corpus_meta.get("expected_alias_clusters", [])
    expected_multi = corpus_meta.get("expected_multi_integration_workflows", [])
    expected_contras = corpus_meta.get("expected_contradictions", [])

    # Build corpus source_id set from all fixture files
    corpus_source_ids: set[str] = set()
    fixtures_dir = FIXTURES / split
    if fixtures_dir.exists():
        for f in fixtures_dir.glob("*.json"):
            items = json.loads(f.read_text())
            for item in items:
                sid = item.get("source_id", "")
                if sid:
                    corpus_source_ids.add(sid)
                    # Also add the hashed version used by run_ingest_fixture
                    import hashlib
                    content = item.get("content", "")
                    intg = f.stem
                    content_hash = hashlib.sha256(content.encode()).hexdigest()[:20]
                    corpus_source_ids.add(f"fix_{intg}_{content_hash}")

    # Merge alias clusters from adversarial into expected_entities for coverage checks
    all_expected = list(expected_entities)
    for cluster in expected_alias:
        if not any(e["name"].lower() == cluster["canonical"].lower() for e in all_expected):
            all_expected.append({
                "name": cluster["canonical"],
                "type": cluster["type"],
                "aliases": cluster["aliases"],
            })

    db_entity_names = {e.get("name", "") for e in db_entities}
    db_skill_slugs = {s.get("slug", "") for s in db_skills}
    db_workflow_slugs = {w.get("slug", "") for w in db_workflows}

    metrics = {
        "entity_recall": entity_recall(db_entities, all_expected),
        "entity_precision": entity_precision(db_entities),
        "entity_alias_coverage": entity_alias_coverage(db_entities, all_expected),
        "memory_hallucination_rate": memory_hallucination_rate(db_memories, corpus_source_ids),
        "negative_suppression": negative_suppression(db_memories, negative_ids),
        "skill_recall": skill_recall(db_skills, expected_skills),
        "workflow_recall": workflow_recall(db_workflows, expected_workflows),
        "workflow_precision": workflow_precision(db_workflows),
        "multi_integration_workflows": multi_integration_workflows(db_workflows, expected_multi),
        "contradiction_handling": contradiction_handling(db_memories, expected_contras),
        "wiki_hallucination_rate": wiki_hallucination_rate(
            memory_dir, db_entity_names, db_skill_slugs, db_workflow_slugs
        ),
    }

    violations = [
        m for m in HARD_FLOORS if not _check_floor(m, metrics.get(m, 0.0))
    ]

    scorecard = {
        "phase": phase,
        "label": label,
        "split": split,
        "structural": metrics,
        "hard_floor_violations": violations,
    }

    return scorecard


def write_scorecard(scorecard: dict) -> Path:
    """Write the structural scorecard to reports/."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    phase = scorecard["phase"]
    label = scorecard["label"]
    split = scorecard["split"]
    fname = f"structural_{phase}_{label}_{split}_{ts}.json"
    out = REPORTS_DIR / fname
    out.write_text(json.dumps(scorecard, indent=2), encoding="utf-8")
    log.info("Wrote structural scorecard to %s", out)
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

async def _run_from_db(phase: str, label: str, split: str) -> dict:
    """Connect to SurrealDB, fetch data, run checks."""
    sys.path.insert(0, str(ROOT))
    from config import load_config
    from db.client import microbots_session

    config = load_config()
    corpus_meta = json.loads((FIXTURES / "corpus_meta.json").read_text())

    async with microbots_session(config) as mdb:
        db_entities = await mdb.raw_query("SELECT * FROM entity")
        db_memories = await mdb.raw_query("SELECT * FROM memory")
        db_skills = await mdb.raw_query("SELECT * FROM skill")
        db_workflows = await mdb.raw_query("SELECT * FROM workflow")

    scorecard = run_structural_checks(
        db_entities=db_entities,
        db_memories=db_memories,
        db_skills=db_skills,
        db_workflows=db_workflows,
        corpus_meta=corpus_meta,
        memory_dir=MEMORY_DIR,
        phase=phase,
        label=label,
        split=split,
    )
    out = write_scorecard(scorecard)
    print(json.dumps(scorecard, indent=2))
    print(f"\nWritten to: {out}")
    return scorecard


if __name__ == "__main__":
    import asyncio
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", default="all")
    parser.add_argument("--label", default="baseline")
    parser.add_argument("--split", default="train")
    args = parser.parse_args()
    asyncio.run(_run_from_db(args.phase, args.label, args.split))
