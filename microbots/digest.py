"""Self-improvement digest — synthesizes the three tag layers into a
useful artifact (markdown report) the agent / human can consume.

The instrumentation pipeline produces three tag layers:

  * Auto-tags on retrievals + failures (every emit)
  * Rule-based ``task_classified`` (mechanical, 12 dims)
  * LLM ``task_classified_llm`` (semantic, Cody-shape)

This module turns those signals into a report that answers:

  1. **What's been going wrong?** Top failure modes by count + last_seen.
  2. **Which docs need updating?** Doc → failure_mode correlations
     (the Agemo doc-issue pipeline collapsed into one query).
  3. **What did the LLM tagger think?** Top semantic friction tags
     and their rationales.
  4. **Where's the agent succeeding?** Successful task patterns —
     useful for "what's our happy path?".

Usage::

    uv run python -m microbots.digest 60          # last 60 minutes
    uv run python -m microbots.digest 60 -m       # markdown to stdout
    uv run python -m microbots.digest 60 --json   # raw dict for LLM input
"""

from __future__ import annotations

import json
import sys
from typing import Any

from microbots.log import setup_logging
from microbots.observability import query_logfire


def _q(sql: str, limit: int = 200) -> list[dict[str, Any]]:
    return query_logfire(sql, limit=limit)


def collect_digest(age_minutes: int = 60) -> dict[str, Any]:
    """Run all the digest queries and return a structured dict."""
    age = max(1, min(int(age_minutes), 7 * 24 * 60))

    # 1) Failure mode breakdown
    failures = _q(f"""
        SELECT attributes->>'label'    AS label,
               attributes->>'severity' AS severity,
               COUNT(*) AS n,
               MAX(start_timestamp)    AS last_seen
        FROM records
        WHERE span_name = 'failure_mode label={{label}} severity={{severity}}'
          AND start_timestamp > now() - interval '{age} minutes'
        GROUP BY 1, 2
        ORDER BY n DESC
        LIMIT 15
    """)

    # 2) Doc-attribution heatmap (the punchline)
    doc_attribution = _q(f"""
        SELECT r.attributes->>'source_doc_id' AS doc,
               r.attributes->>'source_kind'   AS kind,
               f.attributes->>'label'         AS failure_mode,
               COUNT(*) AS n
        FROM records f
        JOIN records r ON r.trace_id = f.trace_id
        WHERE f.span_name = 'failure_mode label={{label}} severity={{severity}}'
          AND r.span_name = 'retrieved_doc'
          AND f.start_timestamp > now() - interval '{age} minutes'
        GROUP BY 1, 2, 3
        ORDER BY n DESC
        LIMIT 20
    """)

    # 3) LLM semantic friction tags + sample rationales
    semantic = _q(f"""
        SELECT tags, attributes->>'rationale' AS rationale
        FROM records
        WHERE span_name = 'task_classified_llm'
          AND start_timestamp > now() - interval '{age} minutes'
        ORDER BY start_timestamp DESC
        LIMIT 30
    """)

    # Aggregate the LLM tag list into chip counts
    chip_counts: dict[str, int] = {}
    for row in semantic:
        for chip in (row.get("tags") or []):
            chip_counts[chip] = chip_counts.get(chip, 0) + 1
    top_chips = sorted(chip_counts.items(), key=lambda kv: -kv[1])[:15]

    # 4) Successful task patterns from rule-based tagger
    successes = _q(f"""
        SELECT attributes->>'intent'         AS intent,
               attributes->>'context-source' AS context,
               COUNT(*) AS n
        FROM records
        WHERE span_name = 'task_classified'
          AND attributes->>'outcome' = 'success'
          AND start_timestamp > now() - interval '{age} minutes'
        GROUP BY 1, 2
        ORDER BY n DESC
        LIMIT 10
    """)

    # 5) Volume + sanity check
    totals = _q(f"""
        SELECT span_name, COUNT(*) AS n
        FROM records
        WHERE service_name = 'microbots'
          AND start_timestamp > now() - interval '{age} minutes'
          AND span_name IN (
              'task_classified',
              'task_classified_llm',
              'retrieved_doc',
              'failure_mode label={{label}} severity={{severity}}'
          )
        GROUP BY 1
    """)

    return {
        "age_minutes": age,
        "totals":          {r["span_name"]: r["n"] for r in totals},
        "failures":        failures,
        "doc_attribution": doc_attribution,
        "semantic_top":    [{"chip": c, "n": n} for c, n in top_chips],
        "semantic_sample": [
            {"tags": r.get("tags") or [], "rationale": r.get("rationale")}
            for r in semantic[:5]
        ],
        "successes":       successes,
    }


def render_markdown(d: dict[str, Any]) -> str:
    """Pretty-print a digest dict as a markdown report."""
    lines: list[str] = []
    age = d["age_minutes"]
    lines.append(f"# Microbots self-improvement digest — last {age} minutes")
    lines.append("")
    totals = d["totals"]
    lines.append(
        f"_Volume:_ "
        f"{totals.get('task_classified', 0)} rule-tagged, "
        f"{totals.get('task_classified_llm', 0)} LLM-tagged, "
        f"{totals.get('retrieved_doc', 0)} retrievals, "
        f"{totals.get('failure_mode label={label} severity={severity}', 0)} failures."
    )
    lines.append("")

    lines.append("## What went wrong")
    if not d["failures"]:
        lines.append("_No failures in window._\n")
    else:
        lines.append("| label | severity | count | last seen |")
        lines.append("|---|---|---|---|")
        for r in d["failures"]:
            lines.append(
                f"| `{r.get('label')}` | {r.get('severity')} | {r.get('n')} "
                f"| {r.get('last_seen')} |"
            )
        lines.append("")

    lines.append("## Doc-attribution: which docs correlate with failures")
    if not d["doc_attribution"]:
        lines.append("_No retrievals correlated with failures in window._\n")
    else:
        lines.append("| doc | kind | failure mode | n |")
        lines.append("|---|---|---|---|")
        for r in d["doc_attribution"]:
            lines.append(
                f"| `{r.get('doc')}` | {r.get('kind')} "
                f"| `{r.get('failure_mode')}` | {r.get('n')} |"
            )
        lines.append("")

    lines.append("## Semantic tags (LLM classifier)")
    if not d["semantic_top"]:
        lines.append("_No LLM classifications in window._\n")
    else:
        lines.append("Top chips:")
        for r in d["semantic_top"]:
            lines.append(f"- `{r['chip']}` — {r['n']}")
        lines.append("")
        lines.append("Recent rationales:")
        for r in d["semantic_sample"]:
            tags = ", ".join(r["tags"][:5])
            lines.append(f"- _[{tags}]_ — {r['rationale']}")
        lines.append("")

    lines.append("## Where the agent succeeds (top happy paths)")
    if not d["successes"]:
        lines.append("_No clear success patterns in window._\n")
    else:
        lines.append("| intent | context | count |")
        lines.append("|---|---|---|")
        for r in d["successes"]:
            lines.append(
                f"| {r.get('intent')} | {r.get('context')} | {r.get('n')} |"
            )
        lines.append("")

    return "\n".join(lines)


def main() -> None:  # pragma: no cover
    setup_logging()
    age = 60
    fmt = "markdown"
    for arg in sys.argv[1:]:
        if arg in ("--json", "-j"):
            fmt = "json"
        elif arg in ("--markdown", "-m"):
            fmt = "markdown"
        else:
            try:
                age = int(arg)
            except ValueError:
                pass
    d = collect_digest(age_minutes=age)
    if fmt == "json":
        sys.stdout.write(json.dumps(d, indent=2, default=str))
        sys.stdout.write("\n")
    else:
        sys.stdout.write(render_markdown(d))
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
