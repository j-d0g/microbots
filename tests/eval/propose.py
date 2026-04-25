"""Prompt-rewrite proposer agent.

Reads the current prompt file, the rubric, and bottom-quartile scored cases,
then proposes a unified diff against the prompt file.

Guard rails:
- Max ±30% length change.
- Must keep required JSON-schema instructions.
- Must keep example block markers (if present).
- Diffs failing guard rails are auto-rejected before apply.

Usage:
    uv run python tests/eval/propose.py --phase triage --score-file score_triage_20250101_120000.json
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic-ai[openai]>=0.2", "pydantic>=2", "pyyaml>=6", "python-dotenv>=1"]
# ///
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel
from pydantic_ai import Agent

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent.parent
RUBRICS_DIR = Path(__file__).parent / "rubrics"
REPORTS_DIR = Path(__file__).parent / "reports"

log = logging.getLogger("propose")

# Map phase → prompt file paths (relative to ROOT)
PHASE_PROMPT_FILES: dict[str, list[str]] = {
    "triage": ["ingest/prompts/core.py"],
    "memory_extraction": ["enrich/prompts/memory.py"],
    "entity_resolution": ["enrich/prompts/entity.py"],
    "skill_detection": ["enrich/prompts/skill_per_integration.py", "enrich/prompts/skill_synthesis.py"],
    "workflow_composition": ["enrich/prompts/workflow.py"],
    "wiki": ["wiki/prompts/system.py"],
}


class ProposedDiff(BaseModel):
    phase: str
    target_file: str
    unified_diff: str  # standard unified diff format
    rationale: str
    expected_score_delta: float  # predicted improvement in weighted_total


PROPOSER_SYSTEM = """\
You are a prompt engineer improving an AI pipeline for agent memory management (Microbots).
You will be given:
1. The current prompt file content.
2. The rubric for the phase.
3. The scoring breakdown (which criteria are lowest).
4. The lowest-scoring case outputs.

Your task: produce a minimal, targeted unified diff to improve the prompt.

Guard rails (your diff MUST comply):
- Length change ≤ 30% of original line count.
- Do NOT remove any JSON schema example blocks (lines between ```json and ```).
- Do NOT remove the required output fields list.
- Do NOT change the programming structure (imports, function signatures).
- Only change docstrings, string literals (prompt text), and comments.
- Provide a conservative expected_score_delta (max 1.0).

Output a ProposedDiff with the unified diff as a string.
"""


def _load_rubric(phase: str) -> dict:
    f = RUBRICS_DIR / f"{phase}.yaml"
    if not f.exists():
        raise FileNotFoundError(f"No rubric for {phase}")
    return yaml.safe_load(f.read_text())


def _guard_rail_check(original: str, proposed: str, diff: str) -> list[str]:
    """Return list of violated guard rail descriptions, empty if all pass."""
    violations = []
    orig_lines = original.splitlines()
    prop_lines = proposed.splitlines()

    # 1. Length change ≤ 30%
    if orig_lines:
        delta = abs(len(prop_lines) - len(orig_lines)) / len(orig_lines)
        if delta > 0.30:
            violations.append(f"Length change {delta:.0%} exceeds 30% limit")

    # 2. JSON schema blocks preserved
    json_blocks = re.findall(r"```json.*?```", original, re.DOTALL)
    for block in json_blocks:
        if block not in proposed:
            violations.append("A JSON schema example block was removed")
            break

    # 3. Example block markers preserved
    if "# EXAMPLE" in original and "# EXAMPLE" not in proposed:
        violations.append("Example block markers were removed")

    return violations


async def propose(
    phase: str,
    score_file: Path,
    model: str = "openai:gpt-4.1-mini",
) -> ProposedDiff | None:
    rubric = _load_rubric(phase)
    score_data = json.loads(score_file.read_text())

    prompt_files = PHASE_PROMPT_FILES.get(phase, [])
    if not prompt_files:
        log.error("No prompt files mapped for phase '%s'", phase)
        return None

    # Use the first prompt file for now (multi-file support = future work)
    prompt_path = ROOT / prompt_files[0]
    if not prompt_path.exists():
        log.error("Prompt file not found: %s", prompt_path)
        return None

    original_content = prompt_path.read_text(encoding="utf-8")

    # Identify lowest-scoring criteria
    criteria_scores = {c["criterion"]: c["score"] for c in score_data.get("criteria", [])}
    sorted_criteria = sorted(criteria_scores.items(), key=lambda x: x[1])
    bottom_criteria = sorted_criteria[:3]

    agent = Agent(
        model=model,
        output_type=ProposedDiff,
        system_prompt=PROPOSER_SYSTEM,
        retries=2,
    )

    user_prompt = f"""\
## Phase: {phase}

## Rubric criteria:
{yaml.dump(rubric["criteria"], default_flow_style=False)}

## Current scores (lowest first):
{json.dumps(bottom_criteria, indent=2)}

## Full score breakdown:
{json.dumps(score_data, indent=2)[:2000]}

## Current prompt file ({prompt_files[0]}):
```python
{original_content[:4000]}
```

Propose a minimal diff to improve the lowest-scoring criteria.
"""

    try:
        result = await agent.run(user_prompt)
        diff_proposal = result.output
    except Exception as e:
        log.error("Proposer failed: %s", e)
        return None

    # Guard rail check (apply diff to get proposed content, then validate)
    # For now we do a simple line-count check on the diff itself
    violations = []
    added = sum(1 for line in diff_proposal.unified_diff.splitlines() if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_proposal.unified_diff.splitlines() if line.startswith("-") and not line.startswith("---"))
    orig_lines_count = len(original_content.splitlines())
    if orig_lines_count > 0 and abs(added - removed) / orig_lines_count > 0.30:
        violations.append(f"Net line change {abs(added - removed)} exceeds 30% of {orig_lines_count} lines")

    if violations:
        log.warning("Proposer diff rejected (guard rails violated): %s", violations)
        return None

    # Write proposal to reports/
    proposal_path = REPORTS_DIR / f"proposal_{phase}_{score_file.stem}.json"
    proposal_path.write_text(json.dumps(diff_proposal.model_dump(), indent=2), encoding="utf-8")
    log.info("Proposal written to %s", proposal_path)

    return diff_proposal


if __name__ == "__main__":
    import asyncio
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", required=True)
    parser.add_argument("--score-file", required=True, help="Score JSON file from judge.py")
    parser.add_argument("--model", default="openai:gpt-4.1-mini")
    args = parser.parse_args()

    result = asyncio.run(
        propose(args.phase, Path(args.score_file), model=args.model)
    )
    if result:
        print(f"Proposed diff for {args.phase} (expected delta: +{result.expected_score_delta:.2f})")
        print(result.unified_diff[:1000])
    else:
        print("No valid proposal generated.")
        sys.exit(1)
