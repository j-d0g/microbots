# Logfire self-improvement loop — STATUS (2026-04-26)

## TL;DR

Code-complete for **Options A + B**, with **Option C** scaffolded.
Cannot fully verify because the LOGFIRE_TOKEN currently in `.env` is
rejected by Logfire (HTTP 401, "Unknown token"). Once a working
write token + a read token are in place, run the verifier:

```sh
uv run python test/verify_logfire_e2e.py
```

Exit 0 = the whole loop works end-to-end.

## What you need to do (≤ 5 min)

1. **Get a working write token.** Logfire UI → your project →
   Settings → look for *Write tokens* (separate from Read). Generate
   one. Replace `LOGFIRE_TOKEN=` in `/Users/jordantran/Agemo/microbots/.env`.

2. **Get a read token.** Same page, *Read tokens* section (the page
   may be tabbed). Add to `.env`:

   ```env
   LOGFIRE_READ_TOKEN=pylf_v2_us_<...>
   ```

3. **Run the verifier:**

   ```sh
   cd /Users/jordantran/Agemo/microbots/.claude/worktrees/feat+logfire-self-improvement
   uv run python test/verify_logfire_e2e.py
   ```

4. **(For the demo)** Pin the dashboard SQL panels — see
   `docs/logfire-dashboard.md`. The UI work is ~5 min: open Logfire
   Dashboards → New panel → SQL → paste each query.

## What's done (verified by unit tests + module load)

| # | Item | Where |
|---|---|---|
| 1 | v2 token region routing fixed | `microbots/log.py` |
| 2 | `traced_retrieval` / `record_retrieval` helpers | `microbots/observability.py` |
| 3 | `emit_failure_mode` + `KNOWN_FAILURE_MODES` | `microbots/observability.py` |
| 4 | Idempotent auto-instrumentation switches | `microbots/observability.py` |
| 5 | `query_logfire` Query API client | `microbots/observability.py` |
| 6 | FastAPI app wired (`setup_logging` + `instrument_fastapi` + `instrument_httpx`) | `app/main.py` |
| 7 | Harness MCP server wired (idempotent setup at import) | `agent/harness/mcp/server.py` |
| 8 | WikiAgent wired (`instrument_pydantic_ai`) | `knowledge_graph/wiki/agent.py` |
| 9 | Doc-attribution spans on `find_examples`, `view_workflow`, `run_workflow`, `search_memory` | `agent/harness/mcp/server.py` |
| 10 | `failure_mode` events on every error path of every harness tool | `agent/harness/mcp/server.py` |
| 11 | New MCP tool `inspect_traces` (ad-hoc SQL over agent's own history) | `agent/harness/mcp/server.py` |
| 12 | New MCP tool `find_recent_failures` (canned aggregation) | `agent/harness/mcp/server.py` |
| 13 | New MCP tool `find_doc_failure_attribution` (the JOIN as a tool) | `agent/harness/mcp/server.py` |
| 14 | Dashboard SQL catalog (5 panels + alert query) | `docs/logfire-dashboard.md` |
| 15 | Logfire alert webhook receiver (Option C scaffold) | `app/routes/api_logfire.py` |
| 16 | Unit tests with `logfire.testing.capfire` | `test/test_observability.py` (6 tests, all green) |
| 17 | End-to-end verifier script | `test/verify_logfire_e2e.py` |

Tool count on the harness MCP went from 8 → 11. Existing test suite
still passes (55 / 55).

## What's NOT done (needs token + manual UI work)

| # | Item | Owner |
|---|---|---|
| V1 | Confirm sample spans actually arrive at Logfire UI | you (run verifier) |
| V2 | Pin SQL panels as a Logfire dashboard | you (UI) |
| V3 | Configure the high-severity alert (Option C trigger) | you (UI, see `docs/logfire-dashboard.md` § Alerting) |
| V4 | Implement actual re-queue logic in `api_logfire.py` (Option C body) | follow-up |

Items V1-V3 are 5-min UI tasks. V4 is the only one with non-trivial
remaining engineering, and it's gated on whether you want to ship
Option C at all.

## Why the demo will land (Option B + the punchline panel)

The doc-attribution heatmap (`docs/logfire-dashboard.md` Panel 2) is
the visible artifact: a single SQL query joins every retrieval the
agent has ever done to every failure_mode that occurred in the same
trace. That's the entire Agemo `documentation-issue-agent` loop
collapsed into one Logfire panel — no separate Postgres, no S3, no
cron container, no batch jobs. Screenshot-ready.

The trace_id correlation is **proven by unit test**
(`test_failure_mode_inside_retrieval_shares_trace_id`) — the JOIN
will work as long as instrumentation is reached.

## Why the demo will land (Option A + agent self-introspection)

Three new MCP tools give the chat agent SQL access to its own
history. The agent can answer "why did that fail?" by literally
querying its own past spans via `inspect_traces(sql=...)`, or
shortcut to `find_recent_failures()` for the canned breakdown. Live
demo: trigger a failure → ask the agent why → it runs SQL → it
explains. This is something Grafana can't do cleanly because it
doesn't pre-bake LLM-aware schemas (`gen_ai.*` semconv).

## Open questions

- **Option C — should we ship it?** Webhook receiver is scaffolded
  (currently a stub that 200s). Implementing the re-queue body is
  ~2-4 more hours and depends on the chat layer's task model. Easier
  to demo Options A + B and call C "v2."

- **Frontend chat agent integration.** The harness MCP is
  server-side, so the new tools (`inspect_traces` etc.) are visible
  to whatever chat client connects to it. If the frontend caches the
  tool list, it may need a refresh / redeploy to pick up the 3 new
  tools.

- **Token in CI / Render env.** The harness MCP runs as a separate
  Render deployment. To get introspection working in production,
  `LOGFIRE_READ_TOKEN` needs to be in that service's env vars too —
  not just local `.env`.

## How to roll back

The whole feature lives on branch
`worktree-feat+logfire-self-improvement`. Drop the branch, no
production state changes outside `.env` (which you control).
