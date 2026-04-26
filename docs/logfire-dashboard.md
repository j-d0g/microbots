# Logfire dashboard — saved SQL panels

This is the catalog of SQL queries that power the self-improvement
loop's read side. Pin each as a saved query in Logfire (UI →
Dashboards → New panel → SQL) and they become live charts. Three of
them (the canned ones) are also exposed as MCP tools the chat agent
can call directly — see ``agent/harness/mcp/server.py``.

All queries assume the instrumentation in ``microbots/observability.py``
is in place: every retrieval emits a ``retrieved_doc`` span with
``source_doc_id`` + ``source_kind`` attributes; every detected
failure emits a ``failure_mode`` span with a ``label`` attribute.

## Conventions

- ``records`` is the single Logfire table. Span-level columns:
  ``timestamp``, ``trace_id``, ``span_id``, ``parent_span_id``,
  ``span_name`` (= the message template), ``service_name``,
  ``duration``. Plus a JSON ``attributes`` column traversed with
  ``->`` (returns JSON) or ``->>`` (returns text).
- All our intentional spans are named after their kind:
  ``retrieved_doc``, ``failure_mode``, ``logging initialized ...``.
- LLM auto-instrumentation (Pydantic AI) emits spans with names
  starting ``chat ``, ``run_tool ``, etc., and follows the
  ``gen_ai.*`` semantic convention for attributes.

## Panel 1 — Failure mode breakdown (last 24h)

Top of the dashboard. Tells you "what is going wrong, how often,
and how badly?" at a glance.

```sql
SELECT
    attributes->>'label'    AS label,
    attributes->>'severity' AS severity,
    COUNT(*)                AS occurrences,
    MAX(timestamp)          AS last_seen
FROM records
WHERE span_name = 'failure_mode label={label} severity={severity}'
  AND timestamp > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY occurrences DESC
```

Visualise as: bar chart, label on x-axis, occurrences on y-axis,
severity as colour fill.

## Panel 2 — Doc-attribution heatmap (THE punchline panel)

The Agemo loop, collapsed into one query. Joins every failure to
every doc/code/memory item that was retrieved in the same trace.
Highest-count cells = "this doc is correlated with these failure
modes" = candidates for documentation improvement.

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
  AND f.timestamp > now() - interval '24 hours'
GROUP BY 1, 2, 3
ORDER BY n DESC
LIMIT 50
```

Visualise as: heatmap (doc on y-axis, failure_mode on x-axis,
colour = n) or a stacked bar (doc on y-axis, failure_mode as colour
stack).

## Panel 3 — Untouched docs in the last week

Inverse of Panel 2 — surfaces docs/templates the agent never reaches
for. These are candidates for either deletion or for promotion
(maybe the agent doesn't *know* about them).

```sql
WITH all_docs AS (
    SELECT DISTINCT attributes->>'source_doc_id' AS doc
    FROM records
    WHERE span_name = 'retrieved_doc'
      AND timestamp > now() - interval '30 days'
),
recent_docs AS (
    SELECT DISTINCT attributes->>'source_doc_id' AS doc
    FROM records
    WHERE span_name = 'retrieved_doc'
      AND timestamp > now() - interval '7 days'
)
SELECT doc
FROM all_docs
WHERE doc NOT IN (SELECT doc FROM recent_docs)
ORDER BY doc
```

## Panel 4 — Tool latency p50/p95 (last 1h)

Performance regression detection. Spikes here usually correlate with
upstream issues (Render Workflows, KG MCP).

```sql
SELECT
    span_name,
    COUNT(*)                                                AS calls,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration)  AS p50_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration)  AS p95_ms,
    MAX(duration)                                           AS max_ms
FROM records
WHERE span_name LIKE 'tool/%'
  AND timestamp > now() - interval '1 hour'
GROUP BY 1
ORDER BY p95_ms DESC
```

(Adjust the ``LIKE`` to match the actual tool-call span naming once
Pydantic AI auto-instrumentation has been observed in production —
this is a placeholder pattern.)

## Panel 5 — LLM token + cost (Pydantic AI integrations)

Auto-emitted by ``logfire.instrument_pydantic_ai()``. No custom
instrumentation needed.

```sql
SELECT
    DATE_TRUNC('hour', timestamp)                 AS hour,
    attributes->>'gen_ai.request.model'           AS model,
    SUM((attributes->>'gen_ai.usage.input_tokens')::int)  AS in_tokens,
    SUM((attributes->>'gen_ai.usage.output_tokens')::int) AS out_tokens
FROM records
WHERE attributes->>'gen_ai.request.model' IS NOT NULL
  AND timestamp > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 1 DESC, in_tokens DESC
```

## Alerting (Option C primer)

For the closed-loop alert → re-run flow, Logfire UI → Alerts → New
alert. Use this SQL with firing mode "any results":

```sql
SELECT trace_id, attributes->>'label' AS label
FROM records
WHERE span_name = 'failure_mode label={label} severity={severity}'
  AND attributes->>'severity' = 'high'
  AND timestamp > now() - interval '5 minutes'
LIMIT 10
```

Webhook destination → ``https://<microbots-app>/api/logfire/alert``
(receiver scaffolded under ``app/routes/api_logfire.py`` — currently
a stub that logs and 200s; swap the body for re-queue logic when
ready).
