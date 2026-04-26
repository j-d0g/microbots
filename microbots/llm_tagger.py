"""LLM-driven semantic tagger — the v2 layer above microbots/tagger.py.

Where the rule-based ``tagger.py`` produces *mechanical* tags
(``intent:code-execute``, ``has-failure:yes``, ``token-band:large``),
this module asks an LLM for *semantic* tags from a Cody-style
controlled taxonomy:

    industry/saas        friction/workflow-error    experience/negative
    industry/devops      friction/missing-context   experience/positive
    task-type/automation quality/high-signal        ...

The output is a single ``task_classified_llm`` span per trace
carrying all the LLM-derived tags as chips and a ``rationale``
attribute. It joins to the rule-based ``task_classified`` on
``target_trace_id`` so dashboard panels can show both layers.

Mirrors Agemo's ``chat-thread-evaluation-processor`` shape — the
prompt template lives in code here rather than in a DB row. Easy
to lift it into a ``chat_thread_prompts`` table later.

Usage::

    uv run python -m microbots.llm_tagger          # last 60 min
    uv run python -m microbots.llm_tagger 30        # last 30 min
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import logfire

from microbots.log import setup_logging
from microbots.observability import query_logfire
from microbots.tagger import _fetch_traces


# ----- controlled taxonomy ------------------------------------------------

# Cody-style: short slash-namespaced labels. Keep dimensions narrow so
# the LLM's choice space is small and stable. Extending = add to the
# enum here AND update the prompt's "valid values" list below.

TAXONOMY: dict[str, list[str]] = {
    "industry": [
        "saas", "devops", "research", "comms", "data",
        "productivity", "ecommerce", "internal-tools",
    ],
    "task-type": [
        "automation", "lookup", "composition", "debug",
        "summarization", "data-transform", "integration", "exploration",
    ],
    "friction": [
        "none", "mild", "blocker",
        "workflow-error", "missing-context", "bad-prompt",
        "tool-misfire", "data-not-found",
    ],
    "experience": [
        "positive", "neutral", "negative", "confused", "recovered",
    ],
    "quality": [
        "high-signal", "exploratory", "noisy", "recovered", "abandoned",
    ],
}


def _flatten_enum() -> list[str]:
    """All ``dim/value`` slugs the LLM is allowed to return."""
    return [f"{dim}/{v}" for dim, vals in TAXONOMY.items() for v in vals]


# ----- prompt -------------------------------------------------------------

SYSTEM_PROMPT = """You classify agent execution traces.

Given a JSON summary of one trace (the spans / tool calls / errors /
retrievals / latencies), return a slash-namespaced tag set from a
fixed taxonomy. Be opinionated — these tags drive a Cody-style chip
view, so visual richness matters.

Rules:
  1. Pick AT MOST ONE value per dimension.
  2. Aim for 4-6 tags per trace. Cover MOST dimensions; only skip a
     dimension if you genuinely have no signal at all (rare).
  3. Output ONLY tags from the allowed list (below).
  4. Write a ONE-LINE rationale (under 80 chars) explaining the
     dominant tag.

Heuristics (use these to fill in even on thin traces):
  - tool ``find_examples`` / ``view_workflow`` → industry/devops or
    industry/internal-tools, task-type/lookup or task-type/composition.
  - tool ``run_code`` / ``run_workflow`` → task-type/automation,
    industry/devops or productivity depending on context.
  - retrievals against ``best_practice`` docs → quality/high-signal,
    industry/devops.
  - retrievals against ``memory`` (kg:*) → industry/comms or
    productivity, task-type/lookup.
  - failure_mode present → set friction/<value> AND experience/<value>.
  - failure_mode absent → friction/none, experience/positive or neutral.

Allowed tags (slash-namespaced):
{enum}
"""


def build_user_message(trace_summary: dict[str, Any]) -> str:
    """Render one trace's compressed shape for the LLM."""
    return (
        "Trace summary:\n"
        + json.dumps(trace_summary, indent=2, default=str)
        + "\n\nReturn the structured classification."
    )


# ----- trace summarization ------------------------------------------------


def summarize_trace(spans: list[dict[str, Any]]) -> dict[str, Any]:
    """Compress a trace's spans into a small dict the LLM can reason over.

    Lossy on purpose — raw spans waste tokens. We keep the doc IDs,
    kinds, and failure labels because those are what the controlled
    taxonomy maps to.
    """
    summary: dict[str, Any] = {
        "n_spans": len(spans),
        "task_span": next(
            (s["span_name"] for s in spans
             if s.get("span_name", "").startswith("task.")),
            None,
        ),
        "tools_called": sorted({s["tool"] for s in spans if s.get("tool")}),
        "retrievals": [
            {
                "doc_id": s.get("source_doc_id"),
                "kind":   s.get("source_kind"),
                "tool":   s.get("tool"),
            }
            for s in spans
            if s.get("span_name") == "retrieved_doc"
        ][:8],
        "failures": [
            {
                "label":    s.get("label"),
                "severity": s.get("severity"),
                "tool":     s.get("tool"),
            }
            for s in spans
            if s.get("span_name", "").startswith("failure_mode")
        ],
        "had_llm_call": any(
            s.get("in_tokens") or s.get("out_tokens") for s in spans
        ),
        "max_duration_s": max(
            (s.get("duration") or 0 for s in spans), default=0
        ),
    }
    return summary


# ----- LLM call -----------------------------------------------------------

_TOOL_SCHEMA = {
    "name": "classify_trace",
    "description": "Apply controlled-taxonomy tags to one agent trace.",
    "input_schema": {
        "type": "object",
        "properties": {
            "tags": {
                "type": "array",
                "description": (
                    "3-6 slash-namespaced tags from the allowed list. "
                    "At most one per dimension. Skip dimensions with "
                    "weak signal."
                ),
                "items": {"type": "string", "enum": _flatten_enum()},
                "minItems": 1,
                "maxItems": 8,
            },
            "rationale": {
                "type": "string",
                "description": "One line, < 80 chars, dominant tag.",
            },
        },
        "required": ["tags", "rationale"],
    },
}


# OpenAI-compatible tool schema (used by OpenRouter / OpenAI providers).
_OPENAI_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "classify_trace",
        "description": "Apply controlled-taxonomy tags to one agent trace.",
        "parameters": {
            "type": "object",
            "properties": {
                "tags": {
                    "type": "array",
                    "description": (
                        "3-6 slash-namespaced tags from the allowed list. "
                        "At most one per dimension. Skip dimensions with "
                        "weak signal."
                    ),
                    "items": {"type": "string", "enum": _flatten_enum()},
                    "minItems": 1,
                    "maxItems": 8,
                },
                "rationale": {
                    "type": "string",
                    "description": "One line, < 80 chars, dominant tag.",
                },
            },
            "required": ["tags", "rationale"],
        },
    },
}


def classify_with_llm(trace_summary: dict[str, Any]) -> dict[str, Any] | None:
    """One LLM call → ``{tags, rationale}`` dict, or None on error.

    Provider priority (mirrors knowledge_graph/wiki/agent.py):
      1. ``OPENROUTER_API_KEY`` → OpenRouter (OpenAI-compatible) using
         a Claude Haiku model — cheapest path that still gives us the
         Anthropic shape.
      2. ``ANTHROPIC_API_KEY`` → Anthropic SDK directly.
      3. ``OPENAI_API_KEY`` → OpenAI SDK directly.

    Forces the ``classify_trace`` tool so the response is structured.
    Auto-instrumented if logfire's instrumentation hooks are on, so
    every classification call also lands as a ``gen_ai.*`` Logfire
    span — meta-observability for free.
    """
    system = SYSTEM_PROMPT.format(enum="\n  ".join(_flatten_enum()))
    user = build_user_message(trace_summary)

    # Path 1 — OpenRouter (preferred for hackathon: OPENROUTER_API_KEY).
    or_key = (os.getenv("OPENROUTER_API_KEY") or "").strip()
    if or_key:
        try:
            from openai import OpenAI
        except ImportError:
            pass
        else:
            client = OpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=or_key,
            )
            try:
                resp = client.chat.completions.create(
                    model="anthropic/claude-haiku-4.5",
                    max_tokens=400,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    tools=[_OPENAI_TOOL_SCHEMA],
                    tool_choice={
                        "type": "function",
                        "function": {"name": "classify_trace"},
                    },
                )
            except Exception as exc:  # noqa: BLE001
                logfire.warn(
                    "llm_tagger: openrouter call failed: {exc_type}: {exc}",
                    exc_type=type(exc).__name__,
                    exc=str(exc)[:200],
                )
                return None
            calls = (resp.choices[0].message.tool_calls or []) if resp.choices else []
            if not calls:
                return None
            try:
                return json.loads(calls[0].function.arguments)
            except (json.JSONDecodeError, AttributeError):
                return None

    # Path 2 — Anthropic SDK directly.
    api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if api_key:
        try:
            import anthropic
        except ImportError:
            return None
        client = anthropic.Anthropic(api_key=api_key)
        try:
            resp = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=400,
                system=system,
                messages=[{"role": "user", "content": user}],
                tools=[{
                    "name": _OPENAI_TOOL_SCHEMA["function"]["name"],
                    "description": _OPENAI_TOOL_SCHEMA["function"]["description"],
                    "input_schema": _OPENAI_TOOL_SCHEMA["function"]["parameters"],
                }],
                tool_choice={"type": "tool", "name": "classify_trace"},
            )
        except Exception as exc:  # noqa: BLE001
            logfire.warn(
                "llm_tagger: anthropic call failed: {exc_type}: {exc}",
                exc_type=type(exc).__name__,
                exc=str(exc)[:200],
            )
            return None
        for block in resp.content:
            if getattr(block, "type", None) == "tool_use":
                return dict(block.input)
        return None

    return None


# ----- driver -------------------------------------------------------------


def tag_recent_traces(age_minutes: int = 60, max_traces: int = 25) -> int:
    """Pull recent traces, LLM-classify each, emit ``task_classified_llm``
    spans with the tags as chips. Returns count of traces tagged.

    ``max_traces`` caps the LLM spend per run. Default 25 traces ≈
    25 Haiku calls ≈ a few cents.
    """
    setup_logging()
    # Auto-instrument the Anthropic SDK so every classification call
    # is itself a Logfire trace — meta-observability for free.
    try:
        logfire.instrument_anthropic()
    except Exception:  # noqa: BLE001
        pass

    by_trace = _fetch_traces(age_minutes)
    # Skip traces we already LLM-tagged in this window.
    already = _already_tagged_ids(age_minutes)
    candidates = [
        (tid, spans) for tid, spans in by_trace.items()
        if tid not in already
    ][:max_traces]

    if not candidates:
        sys.stdout.write(
            f"no untagged traces in last {age_minutes}m "
            f"(of {len(by_trace)} total in window)\n"
        )
        return 0

    n = 0
    for tid, spans in candidates:
        summary = summarize_trace(spans)
        result = classify_with_llm(summary)
        if not result:
            continue
        tags = result.get("tags") or []
        rationale = result.get("rationale") or ""
        # Promote the per-tag dimensions onto attributes too so they
        # join cleanly to the rule-based classifier in dashboards.
        attrs: dict[str, Any] = {}
        for tag in tags:
            if "/" in tag:
                dim, val = tag.split("/", 1)
                attrs.setdefault(dim, val)
        logfire.info(
            "task_classified_llm",
            _tags=list(tags),
            target_trace_id=tid,
            rationale=rationale,
            n_spans=len(spans),
            **attrs,
        )
        n += 1

    sys.stdout.write(
        f"LLM-tagged {n}/{len(candidates)} trace(s) "
        f"(skipped {len(already)} already-tagged in window)\n"
    )
    try:
        logfire.force_flush()
    except Exception:  # noqa: BLE001
        pass
    return n


def _already_tagged_ids(age_minutes: int) -> set[str]:
    sql = f"""
        SELECT attributes->>'target_trace_id' AS tid
        FROM records
        WHERE span_name = 'task_classified_llm'
          AND start_timestamp > now() - interval '{age_minutes} minutes'
    """
    rows = query_logfire(sql, limit=2000)
    return {r["tid"] for r in rows if r.get("tid")}


def main() -> None:  # pragma: no cover
    age = 60
    cap = 25
    if len(sys.argv) > 1:
        try:
            age = int(sys.argv[1])
        except ValueError:
            sys.stderr.write(f"bad age: {sys.argv[1]!r}; using 60\n")
    if len(sys.argv) > 2:
        try:
            cap = int(sys.argv[2])
        except ValueError:
            pass
    tag_recent_traces(age_minutes=age, max_traces=cap)


if __name__ == "__main__":
    main()
