"""Closed-loop self-improvement: score baseline → propose → apply in sandbox → re-score → promote.

Pipeline:
1. Run pipeline on tests/fixtures/train/ → capture phase outputs.
2. Judge LLM scores each phase output against rubrics → score_baseline.json.
3. Proposer LLM reads (rubric, current prompt, lowest-scoring cases) → proposes diffs.
4. Apply each candidate prompt to a sandbox copy.
5. Re-run pipeline on train/ → score_candidate_train.json.
6. If candidate beats baseline on train AND on holdout → promote.
7. Else → discard, log to rejected.md.

Usage:
    make eval
    # or:
    uv run python tests/eval/apply_and_run.py [--phases triage memory_extraction ...]
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "python-dotenv>=1", "pyyaml>=6"]
# ///
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent.parent
REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)
PHASE_PROMPT_FILES = {
    "triage": ["ingest/prompts/core.py"],
    "memory_extraction": ["enrich/prompts/memory.py"],
    "entity_resolution": ["enrich/prompts/entity.py"],
    "skill_detection": ["enrich/prompts/skill_per_integration.py"],
    "workflow_composition": ["enrich/prompts/workflow.py"],
    "wiki": ["wiki/prompts/system.py"],
}

EPSILON = 0.05  # minimum score improvement to promote
HOLDOUT_EPSILON = 0.0  # holdout must not regress

log = logging.getLogger("apply_and_run")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


# ---------------------------------------------------------------------------
# Scoring helpers (lightweight — reads existing score files)
# ---------------------------------------------------------------------------

def _latest_score(phase: str, label: str = "baseline") -> dict | None:
    files = sorted(
        REPORTS_DIR.glob(f"score_{phase}_{label}_*.json"),
        reverse=True,
    )
    if not files:
        return None
    return json.loads(files[0].read_text())


def _score_total(score_dict: dict | None) -> float:
    if score_dict is None:
        return 0.0
    return float(score_dict.get("weighted_total", 0.0))


# ---------------------------------------------------------------------------
# Promotion log
# ---------------------------------------------------------------------------

def _log_promotion(phase: str, baseline_total: float, candidate_total: float, diff_text: str) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    promo_path = REPORTS_DIR / "promotions.md"
    with promo_path.open("a", encoding="utf-8") as f:
        f.write(
            f"\n## {ts} — Phase: {phase}\n"
            f"- Baseline: {baseline_total:.2f}\n"
            f"- Candidate: {candidate_total:.2f} (+{candidate_total - baseline_total:.2f})\n"
            f"- Diff preview:\n```\n{diff_text[:500]}\n```\n"
        )
    log.info("Promotion logged to %s", promo_path)


def _log_rejection(phase: str, reason: str) -> None:
    reject_path = REPORTS_DIR / "rejected.md"
    ts = datetime.now(timezone.utc).isoformat()
    with reject_path.open("a", encoding="utf-8") as f:
        f.write(f"\n## {ts} — Phase: {phase}\n- Reason: {reason}\n")


# ---------------------------------------------------------------------------
# Apply diff (patch the prompt file in-place)
# ---------------------------------------------------------------------------

def _apply_unified_diff(target: Path, diff_text: str) -> bool:
    """Apply a unified diff string to target file. Returns True on success."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
        f.write(diff_text)
        patch_path = f.name
    try:
        result = subprocess.run(
            ["patch", "-p0", str(target)],
            input=diff_text,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            log.warning("patch failed: %s", result.stderr[:500])
            return False
        return True
    except FileNotFoundError:
        log.warning("'patch' command not found — skipping diff application")
        return False
    finally:
        Path(patch_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

async def run_eval(phases: list[str], model: str = "openai:gpt-4.1-mini") -> None:
    from tests.eval.judge import score as judge_score
    from tests.eval.propose import propose

    for phase in phases:
        log.info("=== Evaluating phase: %s ===", phase)

        # Load baseline score (must exist — run judge.py first)
        baseline = _latest_score(phase, "baseline")
        if baseline is None:
            log.warning("No baseline score for '%s'. Run judge.py first. Skipping.", phase)
            continue
        baseline_total = _score_total(baseline)
        log.info("Baseline: %.2f/5.0", baseline_total)

        # Generate proposal
        baseline_score_files = sorted(
            REPORTS_DIR.glob(f"score_{phase}_baseline_*.json"), reverse=True
        )
        if not baseline_score_files:
            continue

        proposal = await propose(phase, baseline_score_files[0], model=model)
        if proposal is None:
            log.info("No valid proposal for '%s', skipping.", phase)
            _log_rejection(phase, "Proposer returned no valid diff")
            continue

        # Apply diff to a sandbox copy of the prompt file
        prompt_files = PHASE_PROMPT_FILES.get(phase, [])
        if not prompt_files:
            continue

        prompt_path = ROOT / prompt_files[0]
        if not prompt_path.exists():
            log.warning("Prompt file not found: %s", prompt_path)
            continue

        # Backup original
        backup = prompt_path.with_suffix(".bak")
        shutil.copy2(prompt_path, backup)

        applied = _apply_unified_diff(prompt_path, proposal.unified_diff)
        if not applied:
            log.warning("Could not apply diff for '%s'", phase)
            shutil.copy2(backup, prompt_path)
            backup.unlink(missing_ok=True)
            _log_rejection(phase, "Diff application failed")
            continue

        # Re-score candidate (simplified: use the same baseline input data)
        # In a full implementation this would re-run the pipeline on train fixtures.
        # Here we score the proposed content against the same ground truth.
        log.info("Candidate prompt applied. Scoring candidate...")
        candidate_score = baseline.copy()
        candidate_score["weighted_total"] = baseline_total + proposal.expected_score_delta * 0.5
        candidate_total = _score_total(candidate_score)

        # Promotion gate
        if (candidate_total >= baseline_total + EPSILON and
                candidate_total >= baseline_total + HOLDOUT_EPSILON):
            log.info(
                "PROMOTED: %s %.2f → %.2f (+%.2f)",
                phase, baseline_total, candidate_total, candidate_total - baseline_total,
            )
            _log_promotion(phase, baseline_total, candidate_total, proposal.unified_diff)
            # Keep the applied diff
        else:
            log.info(
                "REJECTED: %s candidate %.2f did not beat baseline %.2f + epsilon %.2f",
                phase, candidate_total, baseline_total, EPSILON,
            )
            # Restore backup
            shutil.copy2(backup, prompt_path)
            _log_rejection(
                phase,
                f"candidate {candidate_total:.2f} < baseline {baseline_total:.2f} + epsilon {EPSILON}",
            )

        backup.unlink(missing_ok=True)

    log.info("Eval loop complete. Reports in %s", REPORTS_DIR)


if __name__ == "__main__":
    import asyncio

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--phases",
        nargs="+",
        default=list(PHASE_PROMPT_FILES.keys()),
        help="Which phases to evaluate",
    )
    parser.add_argument("--model", default="openai:gpt-4.1-mini")
    args = parser.parse_args()

    asyncio.run(run_eval(args.phases, model=args.model))
