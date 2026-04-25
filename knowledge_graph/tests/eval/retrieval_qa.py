"""KAIG-style retrieval QA runner — graph mode (deterministic) + wiki mode (bundler).

Graph mode: executes named queries per question, scores by scoring_mode. No LLM.
Wiki mode: assembles context from relevant_wiki_paths, emits inputs for Devin to
           answer and self-judge (n=3 protocol).

Usage:
    uv run python tests/eval/retrieval_qa.py \
        --mode graph --label baseline --split train
    uv run python tests/eval/retrieval_qa.py \
        --mode wiki-bundle --label baseline --split train
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "python-dotenv>=1", "pyyaml>=6"]
# ///
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent  # = knowledge_graph/
QA_SET_FILE = Path(__file__).parent / "qa_set.yaml"
REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)
MEMORY_DIR = ROOT / "memory"

log = logging.getLogger("retrieval_qa")

TARGETS = ["next_step", "contact_lookup", "optimisation_surface"]


# ---------------------------------------------------------------------------
# QA set loader
# ---------------------------------------------------------------------------

def load_qa_set() -> list[dict]:
    """Load the 15-question QA set."""
    return yaml.safe_load(QA_SET_FILE.read_text())


# ---------------------------------------------------------------------------
# Scoring functions (graph mode — deterministic)
# ---------------------------------------------------------------------------

def score_exact_match(expected: str | list[str], actual_rows: list[dict]) -> float:
    """Score 0-5: does the expected answer appear in the query results?"""
    if isinstance(expected, list):
        expected_str = expected[0] if expected else ""
    else:
        expected_str = expected

    expected_lower = expected_str.lower()
    text_blob = json.dumps(actual_rows, default=str).lower()

    if expected_lower in text_blob:
        return 5.0
    # Partial match
    words = expected_lower.split()
    matched = sum(1 for w in words if w in text_blob)
    if words:
        return round((matched / len(words)) * 5.0, 2)
    return 0.0


def score_set_recall_at_k(expected: list[str], actual_rows: list[dict]) -> float:
    """Score 0-5: what fraction of expected items appear in results?"""
    if not expected:
        return 5.0
    text_blob = json.dumps(actual_rows, default=str).lower()
    found = sum(1 for item in expected if item.lower() in text_blob)
    return round((found / len(expected)) * 5.0, 2)


def score_free_form_graph(expected: str | list[str], actual_rows: list[dict]) -> float:
    """Heuristic graph-mode score for free_form_judge questions.
    In graph mode we check if the expected answer concept appears in results."""
    if isinstance(expected, list):
        expected_str = " ".join(expected)
    else:
        expected_str = expected

    text_blob = json.dumps(actual_rows, default=str).lower()
    keywords = [w.lower() for w in expected_str.split() if len(w) > 2]
    if not keywords:
        return 0.0
    matched = sum(1 for kw in keywords if kw in text_blob)
    return round(min((matched / len(keywords)) * 5.0, 5.0), 2)


def score_question_graph(question: dict, actual_rows: list[dict]) -> float:
    """Score a single question in graph mode."""
    mode = question["scoring_mode"]
    expected = question["expected_answer"]

    if mode == "exact_match":
        return score_exact_match(expected, actual_rows)
    elif mode == "set_recall_at_k":
        if not isinstance(expected, list):
            expected = [expected]
        return score_set_recall_at_k(expected, actual_rows)
    elif mode == "free_form_judge":
        return score_free_form_graph(expected, actual_rows)
    else:
        log.warning("Unknown scoring_mode: %s", mode)
        return 0.0


# ---------------------------------------------------------------------------
# Graph mode runner
# ---------------------------------------------------------------------------

async def run_graph_mode(label: str, split: str) -> dict:
    """Execute all QA questions in graph mode against SurrealDB."""
    sys.path.insert(0, str(ROOT))
    from config import load_config
    from db.client import microbots_session

    config = load_config()
    questions = load_qa_set()

    results: list[dict] = []

    async with microbots_session(config) as mdb:
        for q in questions:
            query_name = q.get("graph_query_name")
            params = q.get("graph_query_params", {})

            if not query_name:
                results.append({
                    "id": q["id"],
                    "target": q["target"],
                    "score": 0.0,
                    "reason": "no graph_query_name",
                })
                continue

            try:
                rows = await mdb.named_query(query_name, params)
            except Exception as e:
                log.warning("Query '%s' failed for %s: %s", query_name, q["id"], e)
                results.append({
                    "id": q["id"],
                    "target": q["target"],
                    "score": 0.0,
                    "reason": f"query error: {e}",
                })
                continue

            score = score_question_graph(q, rows)
            results.append({
                "id": q["id"],
                "target": q["target"],
                "question": q["question"],
                "score": score,
                "rows_count": len(rows),
            })

    # Aggregate per target
    per_target: dict[str, list[float]] = {t: [] for t in TARGETS}
    for r in results:
        per_target.setdefault(r["target"], []).append(r["score"])

    per_target_means = {
        t: round(sum(scores) / len(scores), 4) if scores else 0.0
        for t, scores in per_target.items()
    }
    qa_graph_total = round(
        sum(per_target_means.values()) / len(per_target_means), 4
    ) if per_target_means else 0.0

    scorecard = {
        "mode": "graph",
        "label": label,
        "split": split,
        "qa_graph_total": qa_graph_total,
        "per_target_means": per_target_means,
        "results": results,
    }

    return scorecard


def write_graph_scorecard(scorecard: dict) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    label = scorecard["label"]
    split = scorecard["split"]
    fname = f"qa_graph_{label}_{split}_{ts}.json"
    out = REPORTS_DIR / fname
    out.write_text(json.dumps(scorecard, indent=2), encoding="utf-8")
    log.info("Wrote graph QA scorecard to %s", out)
    return out


# ---------------------------------------------------------------------------
# Wiki mode bundler
# ---------------------------------------------------------------------------

def run_wiki_bundle(label: str, split: str) -> dict:
    """Assemble wiki-mode QA inputs for Devin to answer and self-judge."""
    questions = load_qa_set()
    bundle: list[dict] = []

    for q in questions:
        wiki_paths = q.get("relevant_wiki_paths", [])
        context_parts = []
        for wp in wiki_paths:
            full_path = MEMORY_DIR.parent / wp if not Path(wp).is_absolute() else Path(wp)
            # Also try under knowledge_graph/
            if not full_path.exists():
                full_path = ROOT / wp
            if full_path.exists():
                context_parts.append(
                    f"--- {wp} ---\n{full_path.read_text(encoding='utf-8', errors='ignore')[:3000]}"
                )
            else:
                context_parts.append(f"--- {wp} --- (not found)")

        bundle.append({
            "id": q["id"],
            "question": q["question"],
            "target": q["target"],
            "expected_answer": q["expected_answer"],
            "scoring_mode": q["scoring_mode"],
            "context": "\n\n".join(context_parts),
        })

    result = {
        "mode": "wiki_bundle",
        "label": label,
        "split": split,
        "questions": bundle,
    }

    return result


def write_wiki_bundle(bundle: dict) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    label = bundle["label"]
    split = bundle["split"]
    fname = f"qa_wiki_inputs_{label}_{split}_{ts}.json"
    out = REPORTS_DIR / fname
    out.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    log.info("Wrote wiki QA bundle to %s", out)
    return out


# ---------------------------------------------------------------------------
# Per-target aggregation helpers (consumed by apply_and_run.py)
# ---------------------------------------------------------------------------

def compute_qa_summary(
    graph_scorecard: dict,
    wiki_median_scorecard: dict | None = None,
) -> dict:
    """Combine graph + wiki scorecards into a single QA summary for gating."""
    summary = {
        "qa_graph_total": graph_scorecard.get("qa_graph_total", 0.0),
        "qa_graph_per_target": graph_scorecard.get("per_target_means", {}),
    }
    if wiki_median_scorecard:
        summary["qa_wiki_total"] = wiki_median_scorecard.get("qa_wiki_total", 0.0)
        summary["qa_wiki_per_target"] = wiki_median_scorecard.get("per_target_means", {})
    else:
        summary["qa_wiki_total"] = 0.0
        summary["qa_wiki_per_target"] = {t: 0.0 for t in TARGETS}
    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import asyncio
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["graph", "wiki-bundle"], default="graph")
    parser.add_argument("--label", default="baseline")
    parser.add_argument("--split", default="train")
    args = parser.parse_args()

    if args.mode == "graph":
        scorecard = asyncio.run(run_graph_mode(args.label, args.split))
        out = write_graph_scorecard(scorecard)
        print(json.dumps(scorecard, indent=2))
        print(f"\nWritten to: {out}")
    elif args.mode == "wiki-bundle":
        bundle = run_wiki_bundle(args.label, args.split)
        out = write_wiki_bundle(bundle)
        print(f"Wiki bundle ({len(bundle['questions'])} questions) written to: {out}")
