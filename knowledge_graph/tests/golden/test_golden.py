"""Golden-output regression tests.

In replay mode (default): loads recorded transcripts from tests/golden/prompts/
and validates the expected_output against the phase's Pydantic model.

In record mode (LLM_MODE=record): runs live agents against fixture data and
writes new goldens.

Each golden case file format:
```json
{
  "phase": "triage",
  "case": "slack_case01",
  "input_fixture": "train/slack.json",
  "input_items_slice": [0, 3],
  "integration": "slack",
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
from pydantic import BaseModel

GOLDEN_DIR = Path(__file__).parent / "prompts"
LLM_MODE = os.getenv("LLM_MODE", "replay")


# ---------------------------------------------------------------------------
# Phase-specific Pydantic models for validation
# ---------------------------------------------------------------------------

def _get_phase_model(phase: str) -> type[BaseModel] | None:
    """Return the Pydantic output model for the given phase, or None."""
    if phase == "triage":
        from ingest.triage import TriagePyd
        return TriagePyd
    if phase == "memory_extraction":
        from enrich.memory_extractor import MemoryExtractionResult
        return MemoryExtractionResult
    if phase == "entity_resolution":
        from enrich.entity_resolver import EntityResolutionResult
        return EntityResolutionResult
    if phase == "skill_detection":
        from enrich.skill_detector import SkillPass1Result
        return SkillPass1Result
    if phase == "workflow_composition":
        from enrich.workflow_composer import WorkflowCompositionResult
        return WorkflowCompositionResult
    return None


# ---------------------------------------------------------------------------
# Load goldens
# ---------------------------------------------------------------------------

def _load_goldens() -> list[dict]:
    if not GOLDEN_DIR.exists():
        return []
    cases = []
    for f in sorted(GOLDEN_DIR.glob("*.json")):
        try:
            cases.append(json.loads(f.read_text()))
        except Exception as e:
            pytest.fail(f"Failed to load golden {f.name}: {e}")
    return cases


_CASES = _load_goldens()


@pytest.mark.parametrize(
    "case",
    _CASES or [{"phase": "none", "case": "skip"}],
    ids=lambda c: f"{c.get('phase', '?')}/{c.get('case', '?')}",
)
def test_golden_replay(case):
    """In replay mode, validate golden output against phase Pydantic model."""
    if case.get("phase") == "none":
        pytest.skip("No golden cases committed yet. Run: make rerecord-goldens")

    if LLM_MODE != "replay":
        pytest.skip("Not in replay mode")

    phase = case["phase"]
    expected = case.get("expected_output", {})

    # Validate golden has required keys
    assert "phase" in case, "Golden case missing 'phase'"
    assert "expected_output" in case, "Golden case missing 'expected_output'"

    # Validate output against phase Pydantic model
    model = _get_phase_model(phase)
    if model is None:
        pytest.skip(f"No Pydantic model registered for phase={phase}")

    validated = model.model_validate(expected)
    assert validated is not None, f"Validation failed for phase={phase}"

    # Phase-specific structural checks
    if phase == "triage":
        assert "chat_records" in expected, "Triage output missing chat_records"
        assert len(expected["chat_records"]) > 0, "Triage output has no chat_records"

    elif phase == "memory_extraction":
        assert "memories" in expected, "Memory output missing memories"
        assert len(expected["memories"]) > 0, "Memory output has no memories"
        for mem in expected["memories"]:
            assert "content" in mem, "Memory item missing content"
            assert "memory_type" in mem, "Memory item missing memory_type"


@pytest.mark.parametrize(
    "case",
    _CASES or [{"phase": "none", "case": "skip"}],
    ids=lambda c: f"{c.get('phase', '?')}/{c.get('case', '?')}",
)
def test_golden_record(case):
    """In record mode, this would run live agents and write new goldens.

    Not yet wired — requires LLM API keys and fixture-to-agent runners.
    """
    if case.get("phase") == "none":
        pytest.skip("No golden cases")

    if LLM_MODE != "record":
        pytest.skip("Not in record mode")

    # Record mode placeholder — implement per-phase agent runners here
    pytest.skip(f"Recording mode: agent runner not yet wired for phase={case['phase']}")
