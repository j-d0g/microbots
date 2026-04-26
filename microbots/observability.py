"""Self-improvement primitives layered on top of microbots/log.py.

Two responsibilities:

1. **Span-level structure for the doc-attribution loop.**
   Mirrors the Agemo `consult_docs` → `documentation_issue` pipeline,
   but native to Logfire spans instead of walking ``ChatMessage.parts``
   JSONB. ``traced_retrieval`` and ``emit_failure_mode`` are the two
   primitives every other module composes with.

2. **Idempotent auto-instrumentation switches.**
   ``instrument_pydantic_ai``, ``instrument_fastapi``, ``instrument_httpx``
   wrap Logfire's own switches with a "first-call wins, never raise"
   guard so service entry points can call them unconditionally.

Read more: ``agent/scratchpad/pydantic-logfire-research/`` (the design
notes that motivated this module).
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator

import logfire

from microbots.log import setup_logging

# ----- internal: lazy setup ------------------------------------------------

_INSTRUMENTED = {"pydantic_ai": False, "fastapi": False, "httpx": False}


def _ensure_configured() -> None:
    """Make sure Logfire is configured before we emit anything.

    ``setup_logging`` is itself idempotent, so calling it from every
    primitive is safe and removes a category of "did you remember to
    call setup_logging first?" footguns.
    """
    setup_logging()


# ----- doc-attribution spans ----------------------------------------------


@contextmanager
def traced_retrieval(
    *,
    source_doc_id: str,
    source_kind: str,
    **attrs: Any,
) -> Iterator[Any]:
    """Open a span marking that a doc / code / memory item was pulled into context.

    These spans are the "what did the agent look at?" half of the
    doc-attribution join. Every retrieval the agent performs should be
    wrapped — templates, saved workflows, KG memories, RAG chunks,
    anything that ends up shaping the next LLM call.

    Conventional ``source_kind`` values (extend as needed, but stay
    lower-snake-case):

        ``template``         — find_examples → templates/index.json hit
        ``saved_workflow``   — view_workflow → saved/<slug>.py
        ``memory``           — search_memory → KG memory row
        ``best_practice``    — devx_mcp/best_practices/*.md (when wired)
        ``slack_message``    — KG ingest result
        ``notion_page``      — KG ingest result

    Example::

        with traced_retrieval(source_doc_id=tpl["id"],
                              source_kind="template",
                              query=q,
                              score=score):
            # actual retrieval work happens inside, so timing + child
            # spans are all attributed to this retrieval.
            ...

    Span name is ``retrieved_doc``; queryable via
    ``WHERE span_name = 'retrieved_doc'`` in the Logfire SQL UI.
    """
    _ensure_configured()
    with logfire.span(
        "retrieved_doc",
        source_doc_id=source_doc_id,
        source_kind=source_kind,
        **attrs,
    ) as s:
        yield s


def record_retrieval(
    *,
    source_doc_id: str,
    source_kind: str,
    **attrs: Any,
) -> None:
    """Lightweight (no-duration) variant of ``traced_retrieval``.

    Use inside loops where you'd otherwise open many one-statement
    spans — e.g. ``find_examples`` returning N matches, or
    ``search_memory`` ranking K hits. Emits an info-level event with
    ``span_name = 'retrieved_doc'`` so the doc-attribution SQL JOIN
    treats it identically to a ``traced_retrieval`` span.
    """
    _ensure_configured()
    logfire.info(
        "retrieved_doc",
        source_doc_id=source_doc_id,
        source_kind=source_kind,
        **attrs,
    )


# ----- failure mode tagging -----------------------------------------------

# Rule-based labels we've already settled on. Free-form labels are allowed,
# but please reuse these where possible so dashboard ``GROUP BY label``
# stays meaningful. See doc-attribution proposal in scratchpad/.
KNOWN_FAILURE_MODES = frozenset({
    "tool_error",          # caught exception in a tool implementation
    "tool_timeout",         # tool did not return within its budget
    "empty_result",         # retrieval ran but returned 0 hits
    "workflow_not_found",   # run_workflow / view_workflow on missing slug
    "workflows_timeout",    # Render Workflows runner deadline exceeded
    "workflows_failed",     # Render Workflows runner reported failure
    "kg_unreachable",       # KG MCP HTTP unreachable from search_memory
    "task_failed",          # generic agent-task failure (frontend-attributed)
    "llm_error",            # provider error (rate limit, 5xx, content block)
    "validation_error",     # Pydantic / output schema mismatch
})


def emit_failure_mode(
    label: str,
    *,
    severity: str = "medium",
    **attrs: Any,
) -> None:
    """Emit a sidecar ``failure_mode`` event tagged onto the current trace.

    Logfire / OTel spans are immutable once written — you cannot UPDATE
    a past span to add a "this turned out badly" attribute. The accepted
    pattern is to emit a new event in the same trace; OTel's ambient
    trace-context propagation links it to the in-progress trace
    automatically. At query time, ``GROUP BY trace_id`` (or JOINing on
    ``trace_id``) recovers the relationship.

    Use this from inside tool implementations, agent failure callbacks,
    or any place where you've detected something the loop should learn
    from. ``label`` should be lower_snake_case; reuse the values in
    ``KNOWN_FAILURE_MODES`` whenever possible so the dashboard's
    ``GROUP BY label`` stays meaningful — but free-form is allowed for
    novel modes (LLM-generated labels in a future tagger pass, etc).

    ``severity`` is ``"low" | "medium" | "high"``; mostly there so a
    Logfire alert can fire only on ``high``.

    All extra kwargs become structured attributes on the event.
    """
    _ensure_configured()
    if label not in KNOWN_FAILURE_MODES:
        # Not an error — just nudges callers to consider extending the
        # frozenset if they're inventing a stable new label.
        attrs.setdefault("label_is_novel", True)
    logfire.info(
        "failure_mode label={label} severity={severity}",
        label=label,
        severity=severity,
        **attrs,
    )


# ----- idempotent auto-instrumentation switches ---------------------------


def instrument_pydantic_ai() -> None:
    """Turn on Pydantic AI auto-instrumentation. Idempotent.

    Every ``Agent.run`` / ``Agent.run_sync`` becomes a span with prompt,
    response, tool calls, and token usage as structured ``gen_ai.*``
    attributes. This is the highest-leverage single line of code in
    this whole feature: zero call-site changes, full observability of
    the WikiAgent and any future Pydantic AI agents.
    """
    _ensure_configured()
    if _INSTRUMENTED["pydantic_ai"]:
        return
    try:
        logfire.instrument_pydantic_ai()
        _INSTRUMENTED["pydantic_ai"] = True
    except Exception as exc:  # noqa: BLE001 — never fail startup
        logfire.warn(
            "could not instrument pydantic_ai: {exc_type}: {exc}",
            exc_type=type(exc).__name__,
            exc=str(exc),
        )


def instrument_fastapi(app: Any) -> None:
    """Instrument a FastAPI app. Idempotent per-app via Logfire's own check."""
    _ensure_configured()
    if _INSTRUMENTED["fastapi"]:
        return
    try:
        logfire.instrument_fastapi(app)
        _INSTRUMENTED["fastapi"] = True
    except Exception as exc:  # noqa: BLE001
        logfire.warn(
            "could not instrument fastapi: {exc_type}: {exc}",
            exc_type=type(exc).__name__,
            exc=str(exc),
        )


def instrument_httpx() -> None:
    """Instrument all httpx clients. Idempotent."""
    _ensure_configured()
    if _INSTRUMENTED["httpx"]:
        return
    try:
        logfire.instrument_httpx()
        _INSTRUMENTED["httpx"] = True
    except Exception as exc:  # noqa: BLE001
        logfire.warn(
            "could not instrument httpx: {exc_type}: {exc}",
            exc_type=type(exc).__name__,
            exc=str(exc),
        )


# ----- introspection (Query API) ------------------------------------------

# Read-side helper. Powers the ``inspect_traces`` MCP tool and the
# dashboard SQL author / verifier. Requires LOGFIRE_READ_TOKEN.

_READ_TOKEN_REGION_MAP = {
    "pylf_v1_eu_": "https://logfire-eu.pydantic.dev",
    "pylf_v1_us_": "https://logfire-us.pydantic.dev",
    "pylf_v2_eu_": "https://logfire-eu.pydantic.dev",
    "pylf_v2_us_": "https://logfire-us.pydantic.dev",
}


def _resolve_read_base_url(token: str) -> str:
    explicit = (os.getenv("LOGFIRE_QUERY_BASE_URL") or "").strip()
    if explicit:
        return explicit
    for prefix, url in _READ_TOKEN_REGION_MAP.items():
        if token.startswith(prefix):
            return url
    return "https://logfire-eu.pydantic.dev"


def query_logfire(sql: str, *, limit: int = 500) -> list[dict[str, Any]]:
    """Run a SQL query against Logfire's Query API. Sync, returns rows.

    Auth: ``LOGFIRE_READ_TOKEN`` env var. Region auto-derived from
    token prefix. Used by the ``inspect_traces`` MCP tool and the
    dashboard SQL verifier.

    Raises ``RuntimeError`` if the read token is missing — this is
    surfaced loudly because the whole introspection layer hinges on it.
    """
    import httpx  # transitive via logfire

    token = (os.getenv("LOGFIRE_READ_TOKEN") or "").strip()
    if not token:
        raise RuntimeError(
            "LOGFIRE_READ_TOKEN is not set. Generate one at Logfire UI -> "
            "your project -> Settings -> Read tokens (separate from the "
            "write tokens used by LOGFIRE_TOKEN)."
        )
    base = _resolve_read_base_url(token)
    resp = httpx.get(
        f"{base}/v1/query",
        params={"sql": sql, "limit": str(limit)},
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    body = resp.json()
    # Query API returns row-oriented JSON: {"columns": [...], "rows": [[...]]}
    # OR column-oriented depending on Accept; we requested row-oriented.
    columns = body.get("columns") or []
    rows = body.get("rows") or []
    return [dict(zip(columns, r)) for r in rows]
