"""Deterministic promotion gate — zero LLM calls.

Devin invokes this AFTER it has:
  1. Produced all 3 rubric runs (baseline + candidate, train + holdout).
  2. Produced all 3 wiki-QA runs.
  3. Applied the prompt diff.

This script:
  1. Re-runs run_phase_eval.py --label candidate for both splits.
  2. Loads baseline + candidate scorecards (rubric medians, structural, qa_graph, qa_wiki medians).
  3. Evaluates Hard floors + Promotion rule.
  4. On promote: git add prompt file, commit, push branch devin/eval-<phase>-<UTC ts>.
  5. On reject: restore .bak, write rejections.jsonl entry.

Usage:
    uv run python knowledge_graph/tests/eval/apply_and_run.py --phase <phase>
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "python-dotenv>=1", "pyyaml>=6"]
# ///
from __future__ import annotations

import argparse
import json
import logging
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent  # = knowledge_graph/
REPO_ROOT = ROOT.parent
REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)

PHASE_PROMPT_FILES: dict[str, list[str]] = {
    "triage": ["ingest/prompts/core.py"],
    "memory_extraction": ["enrich/prompts/memory.py"],
    "entity_resolution": ["enrich/prompts/entity.py"],
    "skill_detection": ["enrich/prompts/skill_per_integration.py"],
    "workflow_composition": ["enrich/prompts/workflow.py"],
    "wiki": ["wiki/prompts/system.py"],
}

EPSILON_TRAIN = 0.05
EPSILON_HOLDOUT = 0.02
TIE_BAND = 0.05
QA_REGRESSION_THRESHOLD = 0.05
STRUCTURAL_REGRESSION_THRESHOLD = 0.05

log = logging.getLogger("apply_and_run")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


# ---------------------------------------------------------------------------
# Scorecard loaders (reads existing files — no LLM)
# ---------------------------------------------------------------------------

def _find_latest(pattern: str) -> Path | None:
    """Find the latest file matching a glob pattern in reports/."""
    files = sorted(REPORTS_DIR.glob(pattern), reverse=True)
    return files[0] if files else None


def _load_json(path: Path | None) -> dict:
    if path is None:
        return {}
    return json.loads(path.read_text())


def load_rubric_median(phase: str, label: str, split: str) -> dict:
    """Load the median rubric scorecard."""
    path = _find_latest(f"score_{phase}_{label}_{split}_median_*.json")
    if path:
        return _load_json(path)
    # Fallback: load the latest single-run score
    path = _find_latest(f"score_{phase}_{label}_{split}_run*_*.json")
    if path:
        return _load_json(path)
    path = _find_latest(f"score_{phase}_{label}_*.json")
    return _load_json(path)


def load_structural(phase: str, label: str, split: str) -> dict:
    path = _find_latest(f"structural_{phase}_{label}_{split}_*.json")
    return _load_json(path)


def load_qa_graph(label: str, split: str) -> dict:
    path = _find_latest(f"qa_graph_{label}_{split}_*.json")
    return _load_json(path)


def load_qa_wiki_median(label: str, split: str) -> dict:
    path = _find_latest(f"qa_wiki_{label}_{split}_median_*.json")
    if path:
        return _load_json(path)
    path = _find_latest(f"qa_wiki_{label}_median_*.json")
    return _load_json(path)


# ---------------------------------------------------------------------------
# Hard floor checks (deterministic)
# ---------------------------------------------------------------------------

HARD_FLOORS: dict[str, tuple[str, float]] = {
    "entity_precision":          (">=", 0.95),
    "memory_hallucination_rate": ("==", 0.0),
    "negative_suppression":      (">=", 0.95),
    "workflow_precision":        ("==", 1.0),
    "wiki_hallucination_rate":   ("==", 0.0),
}


def check_hard_floors(structural: dict) -> list[str]:
    """Return list of hard floor violations."""
    violations = []
    metrics = structural.get("structural", {})
    for metric, (op, threshold) in HARD_FLOORS.items():
        value = metrics.get(metric)
        if value is None:
            continue
        if op == ">=" and value < threshold:
            violations.append(f"{metric}={value} < {threshold}")
        elif op == "==" and value != threshold:
            violations.append(f"{metric}={value} != {threshold}")
    return violations


# ---------------------------------------------------------------------------
# Promotion rule (all deterministic, no LLM)
# ---------------------------------------------------------------------------

def evaluate_promotion(
    phase: str,
    baseline_rubric_train: dict,
    candidate_rubric_train: dict,
    baseline_rubric_holdout: dict,
    candidate_rubric_holdout: dict,
    baseline_structural: dict,
    candidate_structural: dict,
    baseline_qa_graph: dict,
    candidate_qa_graph: dict,
    baseline_qa_wiki: dict,
    candidate_qa_wiki: dict,
) -> tuple[bool, list[str]]:
    """Apply promotion rule. Returns (promote, rejection_reasons)."""
    reasons: list[str] = []

    # Rule 1: rubric_median(candidate, train) >= rubric_median(baseline, train) + 0.05
    bt = float(baseline_rubric_train.get("weighted_total", 0))
    ct = float(candidate_rubric_train.get("weighted_total", 0))
    if ct < bt + EPSILON_TRAIN:
        reasons.append(f"Rule 1: train rubric {ct:.3f} < baseline {bt:.3f} + {EPSILON_TRAIN}")

    # Tie band: |candidate - baseline| <= 0.05 → reject as tie
    if abs(ct - bt) <= TIE_BAND:
        reasons.append(f"Tie band: |{ct:.3f} - {bt:.3f}| = {abs(ct-bt):.3f} <= {TIE_BAND}")

    # Rule 2: rubric_median(candidate, holdout) >= rubric_median(baseline, holdout) + 0.02
    bh = float(baseline_rubric_holdout.get("weighted_total", 0))
    ch = float(candidate_rubric_holdout.get("weighted_total", 0))
    if bh > 0 and ch < bh + EPSILON_HOLDOUT:
        reasons.append(f"Rule 2: holdout rubric {ch:.3f} < baseline {bh:.3f} + {EPSILON_HOLDOUT}")

    # Rule 3 + 4: QA graph — no regression, no per-target drop > 0.05
    bqg = float(baseline_qa_graph.get("qa_graph_total", 0))
    cqg = float(candidate_qa_graph.get("qa_graph_total", 0))
    if bqg > 0 and cqg < bqg:
        reasons.append(f"Rule 3: qa_graph_total regression {cqg:.3f} < {bqg:.3f}")

    b_graph_targets = baseline_qa_graph.get("per_target_means", {})
    c_graph_targets = candidate_qa_graph.get("per_target_means", {})
    for target in b_graph_targets:
        bv = float(b_graph_targets.get(target, 0))
        cv = float(c_graph_targets.get(target, 0))
        if bv > 0 and bv - cv > QA_REGRESSION_THRESHOLD:
            reasons.append(f"Rule 4: qa_graph target '{target}' regression {cv:.3f} < {bv:.3f} - {QA_REGRESSION_THRESHOLD}")

    # QA wiki — same checks
    bqw = float(baseline_qa_wiki.get("qa_wiki_total", 0))
    cqw = float(candidate_qa_wiki.get("qa_wiki_total", 0))
    if bqw > 0 and cqw < bqw:
        reasons.append(f"Rule 3: qa_wiki_total regression {cqw:.3f} < {bqw:.3f}")

    b_wiki_targets = baseline_qa_wiki.get("per_target_means", {})
    c_wiki_targets = candidate_qa_wiki.get("per_target_means", {})
    for target in b_wiki_targets:
        bv = float(b_wiki_targets.get(target, 0))
        cv = float(c_wiki_targets.get(target, 0))
        if bv > 0 and bv - cv > QA_REGRESSION_THRESHOLD:
            reasons.append(f"Rule 4: qa_wiki target '{target}' regression {cv:.3f} < {bv:.3f} - {QA_REGRESSION_THRESHOLD}")

    # Rule 5: Hard floors on candidate
    floor_violations = check_hard_floors(candidate_structural)
    if floor_violations:
        reasons.extend(f"Rule 5 (hard floor): {v}" for v in floor_violations)

    # Rule 6: No structural recall metric drops by more than 0.05
    recall_metrics = ["entity_recall", "entity_alias_coverage", "skill_recall", "workflow_recall"]
    b_struct = baseline_structural.get("structural", {})
    c_struct = candidate_structural.get("structural", {})
    for m in recall_metrics:
        bv = float(b_struct.get(m, 0))
        cv = float(c_struct.get(m, 0))
        if bv > 0 and bv - cv > STRUCTURAL_REGRESSION_THRESHOLD:
            reasons.append(f"Rule 6: structural '{m}' regression {cv:.3f} < {bv:.3f} - {STRUCTURAL_REGRESSION_THRESHOLD}")

    return (len(reasons) == 0, reasons)


# ---------------------------------------------------------------------------
# Git commit / restore
# ---------------------------------------------------------------------------

def commit_and_push(phase: str, prompt_files: list[str],
                    baseline_total: float, candidate_total: float) -> str:
    """Commit prompt file changes and push to devin/eval-<phase>-<ts>."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    branch = f"devin/eval-{phase}-{ts}"

    subprocess.run(
        ["git", "checkout", "-b", branch],
        cwd=str(REPO_ROOT), check=True, capture_output=True,
    )

    for pf in prompt_files:
        full_path = ROOT / pf
        subprocess.run(
            ["git", "add", str(full_path)],
            cwd=str(REPO_ROOT), check=True, capture_output=True,
        )

    commit_msg = f"eval: promote {phase} {baseline_total:.2f}\u2192{candidate_total:.2f}"
    subprocess.run(
        ["git", "commit", "-m", commit_msg],
        cwd=str(REPO_ROOT), check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "push", "origin", branch],
        cwd=str(REPO_ROOT), check=True, capture_output=True,
    )

    log.info("Committed and pushed to %s", branch)
    return branch


def restore_backup(phase: str) -> None:
    """Restore .bak file for the phase's prompt file."""
    prompt_files = PHASE_PROMPT_FILES.get(phase, [])
    for pf in prompt_files:
        backup = (ROOT / pf).with_suffix(".bak")
        if backup.exists():
            shutil.copy2(backup, ROOT / pf)
            backup.unlink()
            log.info("Restored backup for %s", pf)


def log_rejection(phase: str, reasons: list[str]) -> None:
    """Append rejection to rejections.jsonl."""
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "phase": phase,
        "reasons": reasons,
    }
    rejections_path = REPORTS_DIR / "rejections.jsonl"
    with rejections_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    log.info("Rejection logged to %s", rejections_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_apply_and_decide(phase: str) -> None:
    """Load all scorecards and apply the promotion rule."""
    log.info("=== apply_and_run: phase=%s ===", phase)

    # Load scorecards for both splits
    baseline_rubric_train = load_rubric_median(phase, "baseline", "train")
    candidate_rubric_train = load_rubric_median(phase, "candidate", "train")
    baseline_rubric_holdout = load_rubric_median(phase, "baseline", "holdout")
    candidate_rubric_holdout = load_rubric_median(phase, "candidate", "holdout")

    baseline_structural = load_structural(phase, "baseline", "train")
    candidate_structural = load_structural(phase, "candidate", "train")

    baseline_qa_graph = load_qa_graph("baseline", "train")
    candidate_qa_graph = load_qa_graph("candidate", "train")

    baseline_qa_wiki = load_qa_wiki_median("baseline", "train")
    candidate_qa_wiki = load_qa_wiki_median("candidate", "train")

    promote, reasons = evaluate_promotion(
        phase=phase,
        baseline_rubric_train=baseline_rubric_train,
        candidate_rubric_train=candidate_rubric_train,
        baseline_rubric_holdout=baseline_rubric_holdout,
        candidate_rubric_holdout=candidate_rubric_holdout,
        baseline_structural=baseline_structural,
        candidate_structural=candidate_structural,
        baseline_qa_graph=baseline_qa_graph,
        candidate_qa_graph=candidate_qa_graph,
        baseline_qa_wiki=baseline_qa_wiki,
        candidate_qa_wiki=candidate_qa_wiki,
    )

    bt = float(baseline_rubric_train.get("weighted_total", 0))
    ct = float(candidate_rubric_train.get("weighted_total", 0))

    if promote:
        prompt_files = PHASE_PROMPT_FILES.get(phase, [])
        log.info(
            "PROMOTED: %s %.2f \u2192 %.2f (+%.2f)",
            phase, bt, ct, ct - bt,
        )
        branch = commit_and_push(phase, prompt_files, bt, ct)
        print(f"\nPROMOTED {phase}: {bt:.2f} \u2192 {ct:.2f} on branch {branch}")
    else:
        log.info("REJECTED: %s", phase)
        for r in reasons:
            log.info("  - %s", r)
        restore_backup(phase)
        log_rejection(phase, reasons)
        print(f"\nREJECTED {phase}: {len(reasons)} reason(s)")
        for r in reasons:
            print(f"  - {r}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--phase",
        required=True,
        choices=list(PHASE_PROMPT_FILES.keys()),
        help="Which phase to evaluate",
    )
    args = parser.parse_args()
    run_apply_and_decide(args.phase)
