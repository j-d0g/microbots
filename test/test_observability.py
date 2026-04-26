"""Unit tests for microbots/observability.py.

Uses logfire's ``capfire`` pytest fixture to capture in-memory spans
without needing a Logfire backend / token. Each test asserts on the
shape of the spans/events emitted, so the doc-attribution dashboard
queries (which assume specific ``span_name`` and ``attributes`` keys)
keep working even as the implementation evolves.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make the project root importable when invoked from any pytest config.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from microbots import (  # noqa: E402
    KNOWN_FAILURE_MODES,
    emit_failure_mode,
    record_retrieval,
    setup_logging,
    traced_retrieval,
)


@pytest.fixture(autouse=True)
def _ensure_setup() -> None:
    setup_logging()


def _span_names(capfire) -> list[str]:
    """Extract the message/span-name from each exported span."""
    return [span["name"] for span in capfire.exporter.exported_spans_as_dict()]


def _spans_named(capfire, name: str) -> list[dict]:
    return [s for s in capfire.exporter.exported_spans_as_dict() if s["name"] == name]


# ---- traced_retrieval ----------------------------------------------------


def test_traced_retrieval_emits_span_with_required_attrs(capfire) -> None:
    """The dashboard JOIN keys on ``source_doc_id`` and ``source_kind`` —
    if these go missing the join breaks silently."""
    with traced_retrieval(
        source_doc_id="tpl-123",
        source_kind="template",
        query="hello world",
    ):
        pass

    matches = _spans_named(capfire, "retrieved_doc")
    assert matches, f"no retrieved_doc span. saw: {_span_names(capfire)}"
    attrs = matches[-1]["attributes"]
    assert attrs["source_doc_id"] == "tpl-123"
    assert attrs["source_kind"] == "template"
    assert attrs["query"] == "hello world"


def test_record_retrieval_emits_event_with_same_shape(capfire) -> None:
    """The lightweight variant must produce a span queryable on the same
    name + same attribute keys, otherwise the dashboard query breaks."""
    record_retrieval(
        source_doc_id="kg:mem-42",
        source_kind="memory",
        score=0.87,
    )
    matches = _spans_named(capfire, "retrieved_doc")
    assert matches, f"no retrieved_doc event. saw: {_span_names(capfire)}"
    attrs = matches[-1]["attributes"]
    assert attrs["source_doc_id"] == "kg:mem-42"
    assert attrs["source_kind"] == "memory"
    assert attrs["score"] == 0.87


# ---- emit_failure_mode ---------------------------------------------------


def test_emit_failure_mode_with_known_label(capfire) -> None:
    emit_failure_mode("workflows_timeout", severity="high", tool="run_code")

    matches = _spans_named(capfire, "failure_mode label={label} severity={severity}")
    assert matches, (
        "no failure_mode span. saw: "
        f"{_span_names(capfire)}"
    )
    attrs = matches[-1]["attributes"]
    assert attrs["label"] == "workflows_timeout"
    assert attrs["severity"] == "high"
    assert attrs["tool"] == "run_code"
    # Known labels must NOT be flagged as novel — the dashboard's
    # ``GROUP BY label`` relies on the canonical set.
    assert "label_is_novel" not in attrs


def test_emit_failure_mode_with_novel_label_marks_it(capfire) -> None:
    """Free-form labels are allowed but flagged so they show up in
    "what new modes are emerging?" queries."""
    emit_failure_mode("agent_hallucinated_field", tool="custom_tool")

    matches = _spans_named(capfire, "failure_mode label={label} severity={severity}")
    attrs = matches[-1]["attributes"]
    assert attrs["label"] == "agent_hallucinated_field"
    assert attrs.get("label_is_novel") is True


def test_known_failure_modes_are_lower_snake_case() -> None:
    """Convention guard. The dashboard SQL uses ``GROUP BY label`` with
    a known set; if someone adds an inconsistent label, fail loudly."""
    for label in KNOWN_FAILURE_MODES:
        assert label == label.lower(), f"{label!r} not lowercase"
        assert " " not in label, f"{label!r} contains space"
        assert "-" not in label, f"{label!r} should use _ not -"


# ---- trace correlation ---------------------------------------------------


def test_failure_mode_inside_retrieval_shares_trace_id(capfire) -> None:
    """The doc-attribution JOIN keys on trace_id. A failure_mode emitted
    while a retrieval span is open MUST land in the same trace as the
    retrieval — otherwise the dashboard misses the correlation."""
    with traced_retrieval(source_doc_id="doc-7", source_kind="best_practice"):
        emit_failure_mode("validation_error", tool="wiki_agent")

    spans = capfire.exporter.exported_spans_as_dict()
    retrieval = next(s for s in spans if s["name"] == "retrieved_doc")
    failure = next(
        s for s in spans
        if s["name"] == "failure_mode label={label} severity={severity}"
    )
    assert retrieval["context"]["trace_id"] == failure["context"]["trace_id"], (
        "retrieval and failure landed in different traces — JOIN will miss them"
    )
