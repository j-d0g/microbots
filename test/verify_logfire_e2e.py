"""End-to-end verifier for the Logfire self-improvement loop.

Run this AFTER setting working ``LOGFIRE_TOKEN`` (write) and
``LOGFIRE_READ_TOKEN`` (read) env vars. It does the full round trip:

    1. Emit a sample retrieval + failure_mode pair.
    2. Force-flush the OTel exporter.
    3. Wait for ingestion.
    4. Query the records back via the Query API.
    5. Print the doc-attribution dashboard query result.

Exit code 0 = the whole pipeline works end-to-end and the demo is
ready. Non-zero = something broke; the script prints what.

    uv run python test/verify_logfire_e2e.py
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from microbots import (  # noqa: E402
    emit_failure_mode,
    get_logger,
    query_logfire,
    setup_logging,
    traced_retrieval,
)


def _step(label: str) -> None:
    sys.stdout.write(f"\n=== {label} ===\n")
    sys.stdout.flush()


def main() -> int:
    setup_logging()
    log = get_logger("verify")

    write_token = (os.getenv("LOGFIRE_TOKEN") or "").strip()
    read_token = (os.getenv("LOGFIRE_READ_TOKEN") or "").strip()

    if not write_token:
        sys.stderr.write("FAIL: LOGFIRE_TOKEN is empty.\n")
        return 2
    if not read_token:
        sys.stderr.write(
            "FAIL: LOGFIRE_READ_TOKEN is empty. Generate a Read token in\n"
            "Logfire UI -> Project -> Settings -> Read tokens.\n"
        )
        return 2

    # A unique tag we can search for after ingestion.
    nonce = uuid.uuid4().hex[:10]

    _step(f"step 1: emit sample retrieval + failure_mode (nonce={nonce})")
    with traced_retrieval(
        source_doc_id=f"verify-doc-{nonce}",
        source_kind="best_practice",
        verifier_nonce=nonce,
    ):
        emit_failure_mode(
            "validation_error",
            severity="medium",
            tool="verify_logfire_e2e",
            verifier_nonce=nonce,
        )
    log.info("emitted retrieval + failure_mode for nonce={n}", n=nonce)

    _step("step 2: force-flush OTel exporter")
    import logfire
    try:
        logfire.force_flush()
        sys.stdout.write("flush OK\n")
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"WARN: force_flush raised {exc}; ingestion may lag.\n")

    _step("step 3: wait 8s for ingestion")
    time.sleep(8)

    _step("step 4: query retrieved_doc back by nonce")
    sql_retrieval = (
        "SELECT start_timestamp, attributes->>'source_doc_id' AS doc, "
        "attributes->>'source_kind' AS kind "
        "FROM records "
        f"WHERE attributes->>'verifier_nonce' = '{nonce}' "
        "AND span_name = 'retrieved_doc' "
        "ORDER BY start_timestamp DESC"
    )
    try:
        rows = query_logfire(sql_retrieval, limit=10)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"FAIL: query_logfire (retrieval): {exc}\n")
        return 3
    if not rows:
        sys.stderr.write(
            "FAIL: emitted retrieval was not found in Logfire after 8s.\n"
            "Possible causes: write token rejected (check console for 401),\n"
            "different project, or ingestion delay > 8s.\n"
        )
        return 4
    sys.stdout.write(f"OK: found {len(rows)} retrieval row(s):\n")
    for r in rows:
        sys.stdout.write(f"  - {r}\n")

    _step("step 5: query failure_mode back by nonce")
    sql_failure = (
        "SELECT start_timestamp, attributes->>'label' AS label, "
        "attributes->>'severity' AS severity "
        "FROM records "
        f"WHERE attributes->>'verifier_nonce' = '{nonce}' "
        "AND span_name = 'failure_mode label={label} severity={severity}' "
        "ORDER BY start_timestamp DESC"
    )
    try:
        rows = query_logfire(sql_failure, limit=10)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"FAIL: query_logfire (failure_mode): {exc}\n")
        return 5
    if not rows:
        sys.stderr.write("FAIL: failure_mode not found in Logfire.\n")
        return 6
    sys.stdout.write(f"OK: found {len(rows)} failure_mode row(s):\n")
    for r in rows:
        sys.stdout.write(f"  - {r}\n")

    _step("step 6: doc-attribution JOIN (the dashboard punchline query)")
    sql_join = (
        "SELECT r.attributes->>'source_doc_id' AS doc, "
        "r.attributes->>'source_kind' AS kind, "
        "f.attributes->>'label' AS failure_mode, "
        "COUNT(*) AS n "
        "FROM records f "
        "JOIN records r ON r.trace_id = f.trace_id "
        "WHERE f.span_name = 'failure_mode label={label} severity={severity}' "
        "AND r.span_name = 'retrieved_doc' "
        f"AND f.attributes->>'verifier_nonce' = '{nonce}' "
        "GROUP BY 1, 2, 3"
    )
    try:
        rows = query_logfire(sql_join, limit=10)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"FAIL: doc-attribution JOIN failed: {exc}\n")
        return 7
    if not rows:
        sys.stderr.write(
            "FAIL: JOIN found no rows. The retrieval and failure_mode\n"
            "did not share a trace_id — auto-correlation is broken.\n"
        )
        return 8
    sys.stdout.write("OK: doc-attribution JOIN works:\n")
    for r in rows:
        sys.stdout.write(f"  - {r}\n")

    _step("ALL GREEN")
    sys.stdout.write(
        "Logfire self-improvement loop verified end-to-end.\n"
        "Next: pin the SQL queries in docs/logfire-dashboard.md as Logfire\n"
        "dashboard panels via the UI.\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
