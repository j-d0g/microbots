# Logfire demo — the Cody-rich version

After spending a session on this, the visual richness gap with Cody's
screenshots was about **tags**, not data. Logfire spans have a
first-class ``tags`` column that renders as colored chips in the UI;
we were emitting empty arrays. Fixed.

## What we now ship

Every span carries 3-5 tags automatically; every classified trace
carries 12 tags. Run the live tab and rows look like:

```
17:02:46  task_classified  [intent:compose-workflow] [outcome:success]
                            [complexity:multi-step] [token-band:large]
                            [has-llm-call:yes] [context-source:best-practice]
                            [has-retrieval:yes] [has-failure:no]
                            [friction:none] [latency-band:fast]
                            [tools-used-band:single] [novel-failure:no]
```

That's the Cody view. We get it from the ``microbots/tagger.py`` pass
classifying recent traces and emitting one ``task_classified`` span
per trace with the full chip cloud. Rule-based v1; pluggable to LLM
v2 later.

## The actual demo flow

### Setup (do once, ~3 min)

```sh
# 1. Seed realistic agent traces
uv run python test/seed_demo_traces.py

# 2. Wait 8s for ingestion, then classify
sleep 10
uv run python -m microbots.tagger 5
```

(Re-run before going on stage to make the timestamps fresh.)

### Demo arc — 3 acts, ~90s

#### Act 1 — "the agent is observable" (20s)

Open: https://logfire-eu.pydantic.dev/ibrahimdaud03/unicorn-mafia-hackthon

Filter the **Live** tab by typing in the search bar:
```
span_name = 'task_classified'
```
or just paste a tag chip:
```
tags @> ARRAY['intent:code-execute']
```

Point at the chip clouds: "every row is one of our agent's tasks. The
chips are auto-classified — what the user wanted, what tools fired,
what came back. The Logfire UI does this rendering for us, all we did
was set ``_tags`` on the span."

#### Act 2 — "the dashboard tells us what to fix" (40s)

Navigate to **Dashboards → New dashboard → "Self-Improvement"**.

Pin Panel 2 (doc-attribution heatmap) from `docs/logfire-dashboard.md`.

Point at the highest bar: "this doc, when retrieved, is correlated
with this failure mode. Every other doc-improvement loop I know of
needs a separate batch container; here it's one SQL query."

If you want a second panel, add the **chip distribution** query:

```sql
SELECT
    attributes->>'intent'  AS intent,
    attributes->>'outcome' AS outcome,
    COUNT(*) AS n
FROM records
WHERE span_name = 'task_classified'
  AND start_timestamp > now() - interval '7 days'
GROUP BY 1, 2
ORDER BY n DESC
```

Stacked bar, intent on x, outcome as colour stack. Renders the
"intent × outcome" matrix — instant visual of where the agent
struggles.

#### Act 3 — "the agent introspects itself" (30s)

Open the chat agent. Trigger a deliberate fail (run something that
breaks).

Ask: *"What just went wrong, and have I seen this kind of failure
before today?"*

The agent calls `find_recent_failures()` (one of the 3 new MCP tools).
Returns:
```
[{"label": "tool_error", "severity": "medium", "n": 4, "last_seen": ...},
 {"label": "workflows_timeout", "severity": "high", "n": 2, ...}]
```

Agent answers in natural language: "yes — your tool returned a 4xx,
and we've seen 4 instances of that label today, all in the last hour."

That's the wow. The agent SQL-queried its own past behavior in real
time.

## Talking points (drop or keep as you wish)

- **"We replicated Agemo's chat-thread-evaluation-processor in
  ~200 lines of Python plus Logfire."** Mirror reference for whoever
  knows the bigger codebase.

- **"Tags are first-class — Logfire renders them as chips with no UI
  config. Grafana would need a custom plugin to do that."** For the
  Pydantic sponsor angle.

- **"Three views of the same data: Live tab for tail, dashboard for
  patterns, MCP tool for the agent's own introspection."** Explains
  why we picked Logfire over rolling our own.

- **"The classifier is rule-based v1. v2 plugs in an LLM tagger using
  the same controlled taxonomy from Agemo's `init.sql`."** Shows we
  thought about scaling.

## Cheat-sheet queries (paste into Logfire search bar)

- All classified tasks: `span_name = 'task_classified'`
- Just failures: `span_name = 'task_classified' AND attributes->>'outcome' = 'failure'`
- Compose-workflow only: `tags @> ARRAY['intent:compose-workflow']`
- Slow tasks: `tags @> ARRAY['latency-band:slow'] OR tags @> ARRAY['latency-band:very-slow']`
- The doc-attribution traces: `tags @> ARRAY['retrieval'] OR tags @> ARRAY['failure']`

## Falls-back if live demo flakes

- Run the verifier in a terminal: `uv run python test/verify_logfire_e2e.py`
  — printing ALL GREEN with real Logfire URLs is good theatre too.
- Have screenshots of the dashboard ready in slides as backup.

## What the rule-based classifier covers (v1)

12 tags per trace:
- ``intent`` — code-execute / search-memory / compose-workflow / …
- ``complexity`` — single-step / multi-step / long-running
- ``outcome`` — success / partial / failure / in-progress
- ``friction`` — none / mild / blocker
- ``context-source`` — templates / memory / saved-workflow / best-practice / no-context
- ``latency-band`` — fast / normal / slow / very-slow
- ``token-band`` — small / medium / large / xl
- ``tools-used-band`` — single / few / many
- ``has-llm-call``, ``has-retrieval``, ``has-failure``, ``novel-failure`` — yes / no

LLM-tagger v2 (not built) would add Cody-shaped tags like
``industry/saas``, ``experience/negative``, ``friction/workflow-error``
— same prompt template lives in Agemo's `init.sql`.
