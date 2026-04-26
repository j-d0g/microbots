"""/api/logfire — Logfire alert receiver (Option C scaffold).

Receives Logfire alert webhooks (Slack-payload format) and is meant
to drive the closed-loop "alert → re-run failed task" flow.

Current state: STUB. Logs the payload and returns 200 so a Logfire
alert wired to this endpoint will fire successfully end-to-end.
Replace the body of ``handle_alert`` with the actual re-queue logic
when Option C ships.

Wire-up:
  1. Logfire UI → Alerts → New alert
  2. SQL: see ``docs/logfire-dashboard.md`` § Alerting
  3. Destination: webhook → ``https://<microbots-app>/api/logfire/alert``
  4. Optional: shared-secret header check below — set
     ``LOGFIRE_ALERT_SECRET`` in app env and the alert webhook headers.
"""

from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from microbots import emit_failure_mode, get_logger

log = get_logger(__name__)
router = APIRouter(prefix="/logfire", tags=["logfire"])


@router.post("/alert")
async def handle_alert(
    request: Request,
    x_logfire_alert_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    """Receive a Logfire alert and acknowledge.

    Payload shape varies by Logfire version; we accept any JSON and
    log the keys for now. Real handler should:

      1. Parse ``alert.attributes`` to identify failed traces.
      2. For each trace_id, fetch the originating task from the
         knowledge graph or the chat history.
      3. Re-queue the task with an enriched system prompt that
         includes the failure_mode label and the docs that were
         retrieved (Panel 2 in the dashboard).
    """
    expected = (os.environ.get("LOGFIRE_ALERT_SECRET") or "").strip()
    if expected:
        if not x_logfire_alert_secret or not hmac.compare_digest(
            x_logfire_alert_secret, expected
        ):
            # Unauthenticated alert — log it for debugging but don't act.
            emit_failure_mode(
                "tool_error",
                severity="medium",
                tool="logfire_alert_receiver",
                exc_type="UnauthenticatedAlert",
                exc_message="missing or wrong X-Logfire-Alert-Secret header",
            )
            raise HTTPException(status_code=401, detail="unauthorized")

    try:
        payload = await request.json()
    except Exception as exc:  # noqa: BLE001
        log.warn("logfire alert: non-JSON body ({exc})", exc=str(exc))
        payload = {}

    log.info(
        "logfire alert received: keys={keys} payload_size={size}",
        keys=list(payload.keys()) if isinstance(payload, dict) else "(non-dict)",
        size=len(str(payload)),
    )

    # TODO(option-C): re-queue logic here. Until then, just ack.
    return {"status": "received", "action": "logged-only", "todo": "option-c"}
