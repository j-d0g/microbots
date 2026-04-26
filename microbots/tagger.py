"""Cody-style trace classifier — emits rich tag chips per agent run.

The Logfire Live tab in the user's Cody screenshots showed every chat
thread carrying 5-15 tag chips (``industry/saas``, ``friction/...``,
``experience/...``, etc). That visual density is the difference
between "we shipped Logfire" and "we built insight on top of Logfire".

This module bridges the gap. Two passes:

1. **Rule-based classifier (cheap, deterministic).**
   Reads the spans of a single trace via the Query API, derives a
   ~10-tag classification from what actually happened — kinds of
   docs retrieved, tools called, failure modes hit, latency band,
   token usage band — then emits a single ``task_classified`` span
   carrying all those tags. Visible in Logfire UI as chip soup. Runs
   in <1s per trace, no LLM cost.

2. **LLM tagger (for richer semantic tags — optional).**
   Stub for an LLM-driven classifier on top of the rule-based one.
   Mirrors Agemo's ``chat-thread-evaluation-processor`` pattern —
   given a thread, ask an LLM for ``intent/*``, ``domain/*``,
   ``experience/*`` tags from a controlled taxonomy. Out of scope
   for v1; the rule-based pass already gets us the visual story.

Usage::

    from microbots.tagger import classify_recent_traces
    classify_recent_traces(age_minutes=60)

Or as a script::

    uv run python -m microbots.tagger
"""

from __future__ import annotations

import sys
from typing import Any

import logfire

from microbots.log import setup_logging
from microbots.observability import query_logfire


# ----- controlled taxonomy ------------------------------------------------

# Dimensions and the values each can take. Keep these short — they
# render as chips, screen real-estate is the cost. Extending is easy:
# add a new dimension, add the rule that derives it in
# ``derive_classification``.
TAXONOMY: dict[str, set[str]] = {
    "intent": {
        "code-execute", "code-author", "search-memory", "search-templates",
        "compose-workflow", "introspect", "unknown",
    },
    "complexity": {"single-step", "multi-step", "long-running"},
    "outcome": {"success", "partial", "failure", "in-progress"},
    "friction": {"none", "mild", "blocker"},
    "context-source": {
        "templates", "memory", "saved-workflow", "best-practice",
        "no-context",
    },
    "latency-band": {"fast", "normal", "slow", "very-slow"},
    "token-band": {"small", "medium", "large", "xl"},
    "tools-used-band": {"single", "few", "many"},
    "has-llm-call": {"yes", "no"},
    "has-retrieval": {"yes", "no"},
    "has-failure": {"yes", "no"},
    "novel-failure": {"yes", "no"},
}


# ----- rule-based classifier ----------------------------------------------

# Tools whose presence in a trace strongly imply intent.
_INTENT_BY_TOOL = {
    "run_code":          "code-execute",
    "save_workflow":     "compose-workflow",
    "run_workflow":      "code-execute",
    "view_workflow":     "code-author",
    "find_examples":     "search-templates",
    "search_memory":     "search-memory",
    "list_workflows":    "introspect",
    "inspect_traces":    "introspect",
    "find_recent_failures": "introspect",
    "find_doc_failure_attribution": "introspect",
}


def _band_latency(seconds: float | None) -> str:
    if seconds is None:
        return "fast"
    if seconds < 1.0:
        return "fast"
    if seconds < 5.0:
        return "normal"
    if seconds < 30.0:
        return "slow"
    return "very-slow"


def _band_tokens(n: int | None) -> str:
    if not n:
        return "small"
    if n < 1_000:
        return "small"
    if n < 5_000:
        return "medium"
    if n < 20_000:
        return "large"
    return "xl"


def _band_tools(n: int) -> str:
    if n <= 1:
        return "single"
    if n <= 4:
        return "few"
    return "many"


def derive_classification(spans: list[dict[str, Any]]) -> dict[str, str]:
    """Run the rule-based classifier over the spans of one trace.

    Returns a dict ``{dimension: value}`` covering every dimension in
    ``TAXONOMY``. Caller turns it into a flat ``[f"{k}:{v}"]`` tag
    list for emission.
    """
    cls: dict[str, str] = {}

    # Prefer intent from the outer task.* span when present — that's
    # the user's actual goal, not just whatever tool fired first.
    task_intent_map = {
        "task.run_code":           "code-execute",
        "task.code_execute":       "code-execute",
        "task.search_memory":      "search-memory",
        "task.search_templates":   "search-templates",
        "task.compose_workflow":   "compose-workflow",
        "task.code_author":        "code-author",
        "task.introspect":         "introspect",
    }
    task_intent = next(
        (task_intent_map[s["span_name"]] for s in spans
         if s.get("span_name") in task_intent_map),
        None,
    )

    tool_names = [s.get("tool") for s in spans if s.get("tool")]
    intents = [_INTENT_BY_TOOL.get(t, "unknown") for t in tool_names]
    cls["intent"] = (
        task_intent
        or next((i for i in intents if i != "unknown"), None)
        or ("introspect" if not tool_names else "unknown")
    )

    cls["tools-used-band"] = _band_tools(len(set(tool_names)))

    has_retrieval = any(s.get("span_name") == "retrieved_doc" for s in spans)
    cls["has-retrieval"] = "yes" if has_retrieval else "no"

    has_failure = any(
        s.get("span_name", "").startswith("failure_mode") for s in spans
    )
    cls["has-failure"] = "yes" if has_failure else "no"

    novel = any(s.get("label_is_novel") for s in spans)
    cls["novel-failure"] = "yes" if novel else "no"

    # context-source: which doc kinds did the agent reach for
    kinds = {s.get("source_kind") for s in spans if s.get("source_kind")}
    if not kinds:
        cls["context-source"] = "no-context"
    elif "best_practice" in kinds:
        cls["context-source"] = "best-practice"
    elif "saved_workflow" in kinds:
        cls["context-source"] = "saved-workflow"
    elif "memory" in kinds:
        cls["context-source"] = "memory"
    else:
        cls["context-source"] = "templates"

    # complexity: how many distinct spans
    n_spans = len(spans)
    if n_spans <= 3:
        cls["complexity"] = "single-step"
    elif n_spans <= 10:
        cls["complexity"] = "multi-step"
    else:
        cls["complexity"] = "long-running"

    # outcome rules:
    severities = {s.get("severity") for s in spans if s.get("severity")}
    if "high" in severities:
        cls["outcome"] = "failure"
    elif has_failure:
        cls["outcome"] = "partial"
    else:
        cls["outcome"] = "success"

    if "high" in severities:
        cls["friction"] = "blocker"
    elif has_failure:
        cls["friction"] = "mild"
    else:
        cls["friction"] = "none"

    # latency: longest single span
    durations = [s.get("duration") for s in spans if isinstance(s.get("duration"), (int, float))]
    longest = max(durations) if durations else None
    cls["latency-band"] = _band_latency(longest)

    # token usage from gen_ai instrumentation, if any
    in_toks = sum(int(s.get("in_tokens") or 0) for s in spans)
    out_toks = sum(int(s.get("out_tokens") or 0) for s in spans)
    cls["token-band"] = _band_tokens(in_toks + out_toks)
    cls["has-llm-call"] = "yes" if (in_toks or out_toks) else "no"

    return cls


def classification_to_tags(cls: dict[str, str]) -> list[str]:
    """Flatten ``{dim: val}`` into ``[f"{dim}:{val}"]`` chip tags."""
    return [f"{k}:{v}" for k, v in cls.items()]


# ----- driver: classify recent traces -------------------------------------


def _fetch_traces(age_minutes: int) -> dict[str, list[dict[str, Any]]]:
    """Pull all our service's spans in the window and group by trace_id.

    We exclude prior ``task_classified`` spans from the input so that
    re-running the classifier doesn't double-count its own emissions.
    """
    sql = f"""
        SELECT trace_id, span_name, tags, duration,
               attributes->>'tool'           AS tool,
               attributes->>'source_kind'    AS source_kind,
               attributes->>'severity'       AS severity,
               attributes->>'label_is_novel' AS label_is_novel,
               attributes->>'gen_ai.usage.input_tokens'  AS in_tokens,
               attributes->>'gen_ai.usage.output_tokens' AS out_tokens
        FROM records
        WHERE service_name = 'microbots'
          AND start_timestamp > now() - interval '{age_minutes} minutes'
          AND span_name != 'task_classified'
    """
    rows = query_logfire(sql, limit=10_000)
    by_trace: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        tid = r.get("trace_id")
        if not tid:
            continue
        by_trace.setdefault(tid, []).append(r)
    # Note on idempotency: each tagger emission is its own trace
    # (logfire.info outside any open span context). The SQL filter
    # ``span_name != 'task_classified'`` excludes those rows entirely,
    # so re-runs don't pull tagger-emission traces back in.
    return by_trace


def classify_recent_traces(age_minutes: int = 60) -> int:
    """Classify every trace in the window, emit a ``task_classified``
    span with the tags as chips. Returns the count of traces tagged.

    Idempotent in spirit (re-running re-tags), but each call adds new
    spans — don't run it on a tight loop.
    """
    setup_logging()
    by_trace = _fetch_traces(age_minutes)
    if not by_trace:
        sys.stdout.write(
            f"no traces in last {age_minutes}m — nothing to classify\n"
        )
        return 0

    n = 0
    for tid, spans in by_trace.items():
        cls = derive_classification(spans)
        tags = classification_to_tags(cls)
        # Emit at info level — these become a row in the Live tab with
        # the full tag chip-cloud rendered. Reference the trace_id we
        # classified so the dashboard can join.
        logfire.info(
            "task_classified",
            _tags=tags,
            target_trace_id=tid,
            n_spans=len(spans),
            **cls,
        )
        n += 1
    sys.stdout.write(
        f"tagged {n} trace(s) over the last {age_minutes}m\n"
    )
    try:
        logfire.force_flush()
    except Exception:  # noqa: BLE001
        pass
    return n


def main() -> None:  # pragma: no cover
    age = 60
    if len(sys.argv) > 1:
        try:
            age = int(sys.argv[1])
        except ValueError:
            sys.stderr.write(f"bad age: {sys.argv[1]!r}; using 60\n")
    classify_recent_traces(age_minutes=age)


if __name__ == "__main__":
    main()
