"""Seed Logfire with a representative cross-section of microbots traces.

Run after the write token is verified. Emits ~30 spans across the
realistic shapes the dashboard panels expect:

  - 10 successful retrievals across template / saved_workflow / memory
  - 6 failure_mode events covering 4 different labels
  - 4 retrieval+failure pairs in the SAME trace (so the doc-attribution
    JOIN has rows to surface)

That's enough to make every panel in docs/logfire-dashboard.md render
something instead of blank-canvas.
"""

from __future__ import annotations

import random
import sys
import time
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from microbots import (  # noqa: E402
    emit_failure_mode,
    get_logger,
    setup_logging,
    span,
    traced_retrieval,
)


SAMPLE_DOCS = [
    ("tpl-fetch-url",         "template"),
    ("tpl-parse-json",        "template"),
    ("tpl-summarize-text",    "template"),
    ("kg:slack-msg-1042",     "memory"),
    ("kg:notion-page-onboard","memory"),
    ("workflow:daily-report", "saved_workflow"),
    ("workflow:slack-digest", "saved_workflow"),
    ("best_practices/auth.md","best_practice"),
    ("best_practices/rag.md", "best_practice"),
]


def main() -> None:
    setup_logging()
    log = get_logger("seed")
    rng = random.Random(2026)

    log.info("seeding demo traces — ~30 spans about to land")

    # 1) Successful retrievals — the agent reaches for various docs.
    for _ in range(10):
        doc, kind = rng.choice(SAMPLE_DOCS)
        with traced_retrieval(
            source_doc_id=doc,
            source_kind=kind,
            tool=rng.choice(["find_examples", "search_memory", "view_workflow"]),
            score=round(rng.uniform(0.3, 0.99), 2),
        ):
            time.sleep(0.005)

    # 2) Pure failure_mode events — failures unattributed to any doc.
    for label, severity, tool in [
        ("workflows_timeout", "high",   "run_code"),
        ("kg_unreachable",    "high",   "search_memory"),
        ("workflow_not_found","medium", "view_workflow"),
        ("empty_result",      "low",    "find_examples"),
        ("workflows_failed",  "high",   "run_code"),
        ("validation_error",  "medium", "wiki_agent"),
    ]:
        emit_failure_mode(label, severity=severity, tool=tool)

    # 3) Retrieval -> failure pairs — these are what populate the
    #    doc-attribution JOIN. Each happens inside one span context so
    #    they share a trace_id.
    pairs = [
        (("best_practices/rag.md",  "best_practice"), "validation_error", "medium"),
        (("tpl-parse-json",          "template"),     "tool_error",       "medium"),
        (("kg:slack-msg-1042",       "memory"),       "empty_result",     "low"),
        (("workflow:daily-report",   "saved_workflow"),"workflows_failed","high"),
    ]
    for (doc, kind), label, severity in pairs:
        with span(f"task.synthetic.{label}", task_kind="seed"):
            with traced_retrieval(source_doc_id=doc, source_kind=kind):
                time.sleep(0.005)
            emit_failure_mode(label, severity=severity, tool="seed")

    log.info("seeding done — flushing")
    import logfire
    try:
        logfire.force_flush()
    except Exception as exc:  # noqa: BLE001
        log.warn("force_flush failed: {exc}", exc=str(exc))
    log.info("seeded — check logfire UI in ~10s")


if __name__ == "__main__":
    main()
