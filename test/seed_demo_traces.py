"""Seed Logfire with REALISTIC multi-step agent traces for demo.

Mirrors what a real microbots chat session looks like — top-level
``task`` span, nested retrievals + tool calls + LLM calls + (sometimes)
failure_mode. Variety across intents, tools, outcomes, doc sources,
latency, token bands. Designed to make the Cody-style chip view
land hard:

  - 30 task traces over a fake "session"
  - 6 distinct intents (code-execute, search-templates, search-memory,
    compose-workflow, code-author, introspect)
  - mix of single-step and multi-step
  - mix of success / partial / failure
  - varying token bands (small / medium / large)
  - varying latency bands

Run after the write token is verified, then run
``uv run python -m microbots.tagger 60`` to add task_classified
chip-clouds for every one of these traces.
"""

from __future__ import annotations

import random
import sys
import time
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import logfire  # noqa: E402

from microbots import (  # noqa: E402
    emit_failure_mode,
    record_retrieval,
    setup_logging,
    span,
    traced_retrieval,
)


SAMPLE_DOCS = [
    ("tpl-fetch-url",            "template"),
    ("tpl-parse-json",           "template"),
    ("tpl-summarize-text",       "template"),
    ("tpl-slack-notify",         "template"),
    ("kg:slack-msg-1042",        "memory"),
    ("kg:notion-onboarding",     "memory"),
    ("kg:linear-task-3201",      "memory"),
    ("workflow:daily-report",    "saved_workflow"),
    ("workflow:slack-digest",    "saved_workflow"),
    ("workflow:csv-cleanup",     "saved_workflow"),
    ("best_practices/auth.md",   "best_practice"),
    ("best_practices/rag.md",    "best_practice"),
    ("best_practices/secrets.md","best_practice"),
]


def _llm_span(rng: random.Random, model: str, in_tok: int, out_tok: int, slow: bool = False) -> None:
    """Emit a faux LLM call span with gen_ai.* attrs that downstream queries
    aggregate on."""
    delay = rng.uniform(0.4, 2.0) if not slow else rng.uniform(4.0, 7.0)
    with logfire.span(
        "chat {model}",
        _tags=["llm-call", f"model:{model.split('/')[-1]}"],
        model=model,
        **{
            "gen_ai.request.model": model,
            "gen_ai.response.model": model,
            "gen_ai.usage.input_tokens": in_tok,
            "gen_ai.usage.output_tokens": out_tok,
        },
    ):
        time.sleep(min(delay, 0.05))  # don't actually sleep that long


def task_code_execute(rng: random.Random, succeed: bool) -> None:
    with span("task.run_code", _tags=["task", "user-intent:code-execute"]):
        with traced_retrieval(
            source_doc_id="tpl-fetch-url",
            source_kind="template",
            tool="find_examples",
            score=0.91,
        ):
            time.sleep(0.005)
        _llm_span(rng, "anthropic/claude-haiku-4-5", 800, 350)
        if not succeed:
            emit_failure_mode("workflows_timeout", severity="high", tool="run_code")
        else:
            time.sleep(0.005)


def task_search_memory(rng: random.Random, succeed: bool) -> None:
    with span("task.search_memory", _tags=["task", "user-intent:recall"]):
        for doc, _kind in rng.sample(
            [d for d in SAMPLE_DOCS if d[1] == "memory"], k=2
        ):
            record_retrieval(
                source_doc_id=doc, source_kind="memory",
                tool="search_memory", score=round(rng.uniform(0.4, 0.95), 2),
            )
        _llm_span(rng, "anthropic/claude-sonnet-4-6", 2400, 700)
        if not succeed:
            emit_failure_mode("kg_unreachable", severity="high", tool="search_memory")


def task_compose_workflow(rng: random.Random, succeed: bool) -> None:
    with span("task.compose_workflow", _tags=["task", "user-intent:author"]):
        # Reads two best_practice docs for context
        for doc, kind in rng.sample(
            [d for d in SAMPLE_DOCS if d[1] == "best_practice"], k=2
        ):
            with traced_retrieval(
                source_doc_id=doc, source_kind=kind,
                tool="find_examples", score=round(rng.uniform(0.6, 0.99), 2),
            ):
                time.sleep(0.003)
        # Big LLM call (compose is expensive)
        _llm_span(rng, "anthropic/claude-sonnet-4-6", 6500, 1800, slow=True)
        # Sometimes a follow-up code execution
        if rng.random() < 0.5:
            with traced_retrieval(
                source_doc_id="workflow:daily-report",
                source_kind="saved_workflow",
                tool="view_workflow",
            ):
                time.sleep(0.003)
        if not succeed:
            emit_failure_mode("validation_error", severity="medium", tool="compose")


def task_introspect(rng: random.Random) -> None:
    with span("task.introspect", _tags=["task", "user-intent:introspect"]):
        record_retrieval(
            source_doc_id="logfire:records",
            source_kind="trace",
            tool="inspect_traces",
            score=1.0,
        )
        _llm_span(rng, "anthropic/claude-haiku-4-5", 1200, 400)


def task_search_templates(rng: random.Random, succeed: bool) -> None:
    with span("task.search_templates", _tags=["task", "user-intent:discover"]):
        for doc, kind in rng.sample(
            [d for d in SAMPLE_DOCS if d[1] == "template"], k=3
        ):
            record_retrieval(
                source_doc_id=doc, source_kind=kind,
                tool="find_examples", score=round(rng.uniform(0.3, 0.95), 2),
            )
        if not succeed:
            emit_failure_mode("empty_result", severity="low", tool="find_examples")


def task_code_author(rng: random.Random, succeed: bool) -> None:
    with span("task.code_author", _tags=["task", "user-intent:author"]):
        for doc, kind in [
            ("tpl-parse-json", "template"),
            ("best_practices/rag.md", "best_practice"),
        ]:
            with traced_retrieval(
                source_doc_id=doc, source_kind=kind,
                tool="find_examples", score=round(rng.uniform(0.5, 0.95), 2),
            ):
                time.sleep(0.003)
        _llm_span(rng, "anthropic/claude-sonnet-4-6", 4200, 1600)
        if not succeed:
            emit_failure_mode("tool_error", severity="medium", tool="run_code")


TASK_FNS = [
    ("code_execute",       task_code_execute,       True),
    ("code_execute",       task_code_execute,       False),
    ("search_memory",      task_search_memory,      True),
    ("search_memory",      task_search_memory,      False),
    ("compose_workflow",   task_compose_workflow,   True),
    ("compose_workflow",   task_compose_workflow,   False),
    ("introspect",         lambda r, _ok: task_introspect(r), True),
    ("search_templates",   task_search_templates,   True),
    ("search_templates",   task_search_templates,   False),
    ("code_author",        task_code_author,        True),
    ("code_author",        task_code_author,        False),
]


def main() -> None:
    setup_logging()
    rng = random.Random(2026)

    sys.stdout.write("seeding 30 realistic agent traces...\n")
    for i in range(30):
        _name, fn, succeed = rng.choice(TASK_FNS)
        # introduce mild jitter so timestamps spread
        time.sleep(0.02)
        try:
            fn(rng, succeed)
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"trace {i} ({_name}): {exc}\n")
    sys.stdout.write("flushing...\n")
    try:
        logfire.force_flush()
    except Exception:  # noqa: BLE001
        pass
    sys.stdout.write("done — wait 8-10s, then run microbots.tagger.\n")


if __name__ == "__main__":
    main()
