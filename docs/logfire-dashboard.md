# Logfire dashboard — saved SQL panels

Catalog of SQL queries that power the self-improvement loop's read
side. Pin each as a saved panel in Logfire (UI → Dashboards → New
panel → SQL) and they become live charts. Three of them are also
exposed as MCP tools the chat agent can call directly — see
`agent/harness/mcp/server.py`.

All queries assume the instrumentation in `microbots/observability.py`
is in place: every retrieval emits a `retrieved_doc` span with
`source_doc_id` + `source_kind`; every detected failure emits a
`failure_mode` event with a `label`; every rule-tagged trace emits
a `task_classified`; every LLM-tagged trace emits a
`task_classified_llm` with a `rationale`.

## Conventions

| Concept | Where it lives |
|---|---|
| Logfire records table | `records` (single, queryable from the Query API or UI) |
| Time column | `start_timestamp` (NOT `timestamp` — common gotcha) |
| Other key columns | `trace_id`, `span_id`, `parent_span_id`, `span_name`, `service_name`, `duration`, `tags` (rendered as chips), `attributes` (JSON) |
| Attribute traversal | `attributes->>'key'` (text) or `attributes->'key'` (JSON) |
| LLM auto-instrumented spans | follow OTel `gen_ai.*` semconv — `gen_ai.usage.input_tokens`, `gen_ai.request.model`, etc. |

## Panel 1 — Failure mode breakdown

> **Question:** what's going wrong, how often, how badly?

```sql
SELECT
    attributes->>'label'    AS label,
    attributes->>'severity' AS severity,
    COUNT(*)                AS occurrences,
    MAX(start_timestamp)    AS last_seen
FROM records
WHERE span_name = 'failure_mode label={label} severity={severity}'
  AND start_timestamp > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY occurrences DESC
```

**Visualise as:** bar chart, label on x-axis, occurrences on y-axis,
severity as colour fill.

**Also exposed as MCP tool:** `find_recent_failures(age_minutes)`.

## Panel 2 — Doc-attribution heatmap (the punchline)

> **Question:** which docs/code/memories correlate with which failures?

The Agemo `documentation-issue-agent` loop, collapsed into one query.
Joins every retrieval to every failure_mode in the same trace.

```sql
SELECT
    r.attributes->>'source_doc_id' AS doc,
    r.attributes->>'source_kind'   AS kind,
    f.attributes->>'label'         AS failure_mode,
    COUNT(*)                       AS n
FROM records f
JOIN records r ON r.trace_id = f.trace_id
WHERE f.span_name = 'failure_mode label={label} severity={severity}'
  AND r.span_name = 'retrieved_doc'
  AND f.start_timestamp > now() - interval '24 hours'
GROUP BY 1, 2, 3
ORDER BY n DESC
LIMIT 50
```

**Visualise as:** heatmap (doc on y, failure_mode on x, colour = n)
or stacked bar (doc on y, failure_mode as colour stack).

**Also exposed as MCP tool:** `find_doc_failure_attribution(age_hours)`.

## Panel 3 — Rule-based classification matrix

> **Question:** what kind of tasks is the agent running, and how do
> they break down by outcome?

```sql
SELECT
    attributes->>'intent'     AS intent,
    attributes->>'outcome'    AS outcome,
    attributes->>'complexity' AS complexity,
    COUNT(*)                  AS n
FROM records
WHERE span_name = 'task_classified'
  AND start_timestamp > now() - interval '7 days'
GROUP BY 1, 2, 3
ORDER BY n DESC
```

**Visualise as:** stacked bar (intent on x, outcome as stack colour).

## Panel 4 — LLM semantic chip distribution (Cody-shape)

> **Question:** what semantic categories is the agent operating in?

```sql
SELECT
    chip.value AS chip,
    COUNT(*)   AS n
FROM records
CROSS JOIN UNNEST(tags) AS chip(value)
WHERE span_name = 'task_classified_llm'
  AND start_timestamp > now() - interval '7 days'
GROUP BY 1
ORDER BY n DESC
LIMIT 30
```

**Visualise as:** bar chart of slash-namespaced labels — gives an
instant sense of "where is our agent operating?" and "what's the
dominant friction category?".

## Panel 5 — Untouched docs (negative space)

> **Question:** which docs/templates is the agent never reaching for?

```sql
WITH all_docs AS (
    SELECT DISTINCT attributes->>'source_doc_id' AS doc
    FROM records
    WHERE span_name = 'retrieved_doc'
      AND start_timestamp > now() - interval '30 days'
),
recent_docs AS (
    SELECT DISTINCT attributes->>'source_doc_id' AS doc
    FROM records
    WHERE span_name = 'retrieved_doc'
      AND start_timestamp > now() - interval '7 days'
)
SELECT doc
FROM all_docs
WHERE doc NOT IN (SELECT doc FROM recent_docs)
ORDER BY doc
```

Candidates for either deletion or for promotion (maybe the agent
doesn't *know* about them).

## Panel 6 — Tool latency p50 / p95

> **Question:** are tools degrading?

```sql
SELECT
    span_name,
    COUNT(*)                                                AS calls,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration)  AS p50_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration)  AS p95_ms,
    MAX(duration)                                           AS max_ms
FROM records
WHERE span_name LIKE 'task.%'
  AND start_timestamp > now() - interval '1 hour'
GROUP BY 1
ORDER BY p95_ms DESC
```

## Panel 7 — LLM token + cost (auto-instrumented)

Auto-emitted by `logfire.instrument_pydantic_ai()` and the
`logfire.instrument_anthropic()` we turn on in `llm_tagger.py`. No
custom instrumentation needed.

```sql
SELECT
    DATE_TRUNC('hour', start_timestamp)                    AS hour,
    attributes->>'gen_ai.request.model'                    AS model,
    SUM((attributes->>'gen_ai.usage.input_tokens')::int)   AS in_tokens,
    SUM((attributes->>'gen_ai.usage.output_tokens')::int)  AS out_tokens
FROM records
WHERE attributes->>'gen_ai.request.model' IS NOT NULL
  AND start_timestamp > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 1 DESC, in_tokens DESC
```

## Alerting (Option C primer)

Logfire UI → Alerts → New alert. Use this SQL with firing mode "any
results":

```sql
SELECT trace_id, attributes->>'label' AS label
FROM records
WHERE span_name = 'failure_mode label={label} severity={severity}'
  AND attributes->>'severity' = 'high'
  AND start_timestamp > now() - interval '5 minutes'
LIMIT 10
```

Webhook destination → `https://<microbots-app>/api/logfire/alert`
(receiver scaffolded under `app/routes/api_logfire.py` — currently a
stub that 200s; swap the body for re-queue logic).

## Quick filter recipes (paste into Logfire search bar)

```
# all classified tasks
span_name = 'task_classified'

# failures only
span_name = 'task_classified' AND attributes->>'outcome' = 'failure'

# Cody-shape LLM tags
span_name = 'task_classified_llm'

# specific industry
tags @> ARRAY['industry/devops']

# specific friction
tags @> ARRAY['friction/tool-misfire']

# recovered tasks (good story)
tags @> ARRAY['experience/recovered']

# slow tasks
tags @> ARRAY['latency-band:slow'] OR tags @> ARRAY['latency-band:very-slow']

# correlated: LLM + rule-based both flagged failure
tags @> ARRAY['outcome:failure'] AND tags @> ARRAY['experience/negative']
```
