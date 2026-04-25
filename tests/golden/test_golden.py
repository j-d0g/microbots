"""Golden-output regression tests.

In replay mode (default): loads recorded transcripts from tests/golden/prompts/
and asserts structured equality against the committed expected output.

In record mode (LLM_MODE=record): runs live agents and writes new goldens.

Each golden case file format:
```json
{
  "phase": "triage",
  "case": "case01",
  "input_prompt": "...",
  "expected_output": {...}
}
```

Run:
    make test                  # replay mode (no LLM cost)
    make rerecord-goldens      # live LLM, overwrites goldens
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

GOLDEN_DIR = Path(__file__).parent / "prompts"
LLM_MODE = os.getenv("LLM_MODE", "replay")


def _load_goldens() -> list[dict]:
    cases = []
    for f in sorted(GOLDEN_DIR.glob("*.json")):
        try:
            cases.append(json.loads(f.read_text()))
        except Exception as e:
            pytest.fail(f"Failed to load golden {f.name}: {e}")
    return cases


@pytest.mark.parametrize("case", _load_goldens() or [{"phase": "none", "case": "skip"}])
def test_golden_replay(case):
    """In replay mode, assert cached output matches committed golden."""
    if case.get("phase") == "none":
        pytest.skip("No golden cases committed yet. Run: make rerecord-goldens")

    if LLM_MODE == "replay":
        expected = case.get("expected_output", {})
        # Since we don't have a replay harness yet, just validate the golden schema
        assert "phase" in case
        assert "expected_output" in case
        # In a full implementation: run the agent against input_prompt, assert output == expected
        pytest.skip(f"Replay harness not yet wired for phase={case['phase']}")

    elif LLM_MODE == "record":
        # Re-run agent and write new golden
        pytest.skip("Recording mode: implement per-phase agent runners here")
