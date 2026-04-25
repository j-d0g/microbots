"""Evaluator LLM agent (judge) — scores phase outputs against rubrics.

Usage:
    uv run python tests/eval/judge.py --phase triage --input score_input.json
    uv run python tests/eval/judge.py --report  # summarise latest eval/reports/
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic-ai[openai]>=0.2", "pydantic>=2", "pyyaml>=6", "python-dotenv>=1"]
# ///
from __future__ import annotations

import argparse
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel
from pydantic_ai import Agent

load_dotenv()
ROOT = Path(__file__).resolve().parent.parent.parent  # = knowledge_graph/
RUBRICS_DIR = Path(__file__).parent / "rubrics"
REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)

log = logging.getLogger("judge")


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class CriterionScore(BaseModel):
    criterion: str
    score: float  # 0–5
    comment: str


class RubricScore(BaseModel):
    phase: str
    weighted_total: float  # 0–5
    passing: bool
    criteria: list[CriterionScore]
    overall_comment: str


class JudgeInput(BaseModel):
    phase: str
    phase_output: dict  # the structured output of the phase being judged
    ground_truth: dict  # slice from corpus_meta or expected outputs


# ---------------------------------------------------------------------------
# Judge agent
# ---------------------------------------------------------------------------

JUDGE_SYSTEM = """\
You are an impartial evaluator for an AI agent memory pipeline called Microbots.
Your task is to score the output of a specific pipeline phase against a rubric.

Rules:
- Score each criterion from 0 (completely wrong) to 5 (perfect).
- Be specific in comments — cite exact evidence from the input.
- Weighted total = sum(score * weight) for all criteria.
- passing = weighted_total >= passing_threshold (from rubric).
- Do not inflate scores. A score of 5 is rare.
"""


def _build_judge_agent(model: str = "openai:gpt-4.1-mini") -> Agent:
    return Agent(
        model=model,
        output_type=RubricScore,
        system_prompt=JUDGE_SYSTEM,
        retries=2,
    )


def _load_rubric(phase: str) -> dict:
    rubric_file = RUBRICS_DIR / f"{phase}.yaml"
    if not rubric_file.exists():
        raise FileNotFoundError(f"No rubric for phase '{phase}'. Expected: {rubric_file}")
    return yaml.safe_load(rubric_file.read_text())


def _build_judge_prompt(rubric: dict, judge_input: JudgeInput) -> str:
    criteria_text = "\n".join(
        f"  - {name} (weight={v['weight']}): {v['description']}"
        for name, v in rubric["criteria"].items()
    )
    return f"""\
## Rubric for phase: {rubric['phase']}

Criteria:
{criteria_text}

Passing threshold: {rubric['passing_threshold']} / 5.0

## Phase output to evaluate:
```json
{json.dumps(judge_input.phase_output, indent=2, default=str)[:4000]}
```

## Ground truth / expected:
```json
{json.dumps(judge_input.ground_truth, indent=2, default=str)[:2000]}
```

Score each criterion 0–5. Compute weighted_total. Set passing accordingly.
"""


async def score(
    phase: str,
    phase_output: dict,
    ground_truth: dict,
    model: str = "openai:gpt-4.1-mini",
) -> RubricScore:
    rubric = _load_rubric(phase)
    agent = _build_judge_agent(model)
    judge_input = JudgeInput(phase=phase, phase_output=phase_output, ground_truth=ground_truth)
    prompt = _build_judge_prompt(rubric, judge_input)
    result = await agent.run(prompt)
    return result.output


def _write_score(phase: str, result: RubricScore, label: str = "") -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    fname = f"score_{phase}_{label}_{ts}.json" if label else f"score_{phase}_{ts}.json"
    out = REPORTS_DIR / fname
    out.write_text(json.dumps(result.model_dump(), indent=2), encoding="utf-8")
    return out


def _print_report() -> None:
    """Summarise the latest score files in reports/."""
    score_files = sorted(REPORTS_DIR.glob("score_*.json"), reverse=True)
    if not score_files:
        print("No score reports found in", REPORTS_DIR)
        return

    print(f"\n{'Phase':<25} {'Total':>6} {'Pass':>5} {'File'}")
    print("-" * 70)
    for f in score_files[:20]:
        try:
            d = json.loads(f.read_text())
            passing = "YES" if d.get("passing") else "NO"
            total = d.get("weighted_total", 0)
            print(f"{d.get('phase', '?'):<25} {total:>6.2f} {passing:>5} {f.name}")
        except Exception as e:
            print(f"  (error reading {f.name}: {e})")


if __name__ == "__main__":
    import asyncio
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", default=None)
    parser.add_argument("--input", default=None, help="JSON file with {phase_output, ground_truth}")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--model", default="openai:gpt-4.1-mini")
    args = parser.parse_args()

    if args.report:
        _print_report()
    elif args.phase and args.input:
        data = json.loads(Path(args.input).read_text())
        result = asyncio.run(
            score(args.phase, data["phase_output"], data.get("ground_truth", {}), args.model)
        )
        out_path = _write_score(args.phase, result)
        print(f"Score: {result.weighted_total:.2f}/5 (pass={result.passing})")
        print(f"Written to: {out_path}")
    else:
        parser.print_help()
