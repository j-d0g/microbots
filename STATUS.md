# Logfire self-improvement loop — STATUS

**Branch:** `worktree-feat+logfire-self-improvement`
**Verified:** end-to-end on live Logfire (EU, project `unicorn-mafia-hackthon`)
**Tests:** 6/6 unit, 55/55 existing, 1/1 e2e verifier ALL GREEN

## What this is

Cody's chat-thread evaluation pipeline (4 batch containers, dedicated
Postgres, S3 buckets, Linear ticket creation) collapsed onto a Logfire
substrate. Same insight — "which docs correlate with which failures?"
— in one SQL query and ~1300 lines of Python. Closes the loop:

```
agent runs → spans land in Logfire → tagger classifies →
  digest synthesises → MCP tool surfaces → agent introspects
```

## Three tag layers

| Layer | Producer | Output span | Tags per span |
|---|---|---|---|
| 1. Auto-tags | every emit | `retrieved_doc`, `failure_mode` | 3-5 |
| 2. Rule-based | `microbots/tagger.py` | `task_classified` | 12 |
| 3. LLM semantic | `microbots/llm_tagger.py` | `task_classified_llm` | 4-6 |

All three render as colored chips in the Logfire UI. Layer 3 returns
Cody-shape labels (`industry/devops`, `friction/tool-misfire`,
`experience/recovered`, …) plus a one-line rationale.

## What's in the box

### Code

| File | Role |
|---|---|
| `microbots/log.py` | Existing logger, fixed v1+v2 region routing |
| `microbots/observability.py` | `traced_retrieval`, `record_retrieval`, `emit_failure_mode`, `query_logfire` |
| `microbots/tagger.py` | Rule-based 12-dim trace classifier |
| `microbots/llm_tagger.py` | LLM Cody-shape classifier (OpenRouter→Anthropic→OpenAI fallback) |
| `microbots/digest.py` | Markdown report synthesising all 3 layers |
| `app/main.py` | `setup_logging` + `instrument_fastapi` + `instrument_httpx` |
| `app/routes/api_logfire.py` | Webhook receiver scaffold (Option C) |
| `agent/harness/mcp/server.py` | 4 new MCP tools, instrumented retrieval/work tools |
| `knowledge_graph/wiki/agent.py` | `instrument_pydantic_ai` for free LLM trace coverage |

### Tests / verifiers

| File | Role |
|---|---|
| `test/test_observability.py` | 6 unit tests (incl. trace_id correlation proof) |
| `test/verify_logfire_e2e.py` | Round-trip: emit → ingest → query-back → JOIN |
| `test/seed_demo_traces.py` | 30 realistic multi-step agent traces |

### Docs

| File | Audience |
|---|---|
| `STATUS.md` (this) | Status + what's pending |
| `docs/logfire-dashboard.md` | SQL panels for the Logfire UI dashboard |
| `docs/logfire-demo-script.md` | 3-act demo flow + cheat-sheet queries |
| `agent/scratchpad/pydantic-logfire-research/` | Research notes that drove the design |

### MCP tools (12 total, +4 new)

```
inspect_traces                 — ad-hoc SQL over agent's own history
find_recent_failures           — canned aggregation by failure label
find_doc_failure_attribution   — doc × failure JOIN as a tool
get_self_improvement_digest    — markdown digest synthesising all 3 layers
```

## Demo flow (90 seconds)

```sh
# Setup (once before going on stage)
uv run python test/seed_demo_traces.py
sleep 10
uv run python -m microbots.tagger 5         # rule-based 12-dim
uv run python -m microbots.llm_tagger 5 12   # LLM 5-dim Cody-shape
```

**Act 1 (20s) — agent is observable.** Open
https://logfire-eu.pydantic.dev/ibrahimdaud03/unicorn-mafia-hackthon →
Live tab → search bar `span_name = 'task_classified_llm'`. Point at
chip clouds: "industry/internal-tools, task-type/composition,
friction/tool-misfire, experience/recovered, quality/high-signal".

**Act 2 (40s) — the dashboard tells us what to fix.** Show the
doc-attribution heatmap from `docs/logfire-dashboard.md`. Point at
the highest bar: "this doc, when retrieved, correlates with this
failure mode. The Agemo doc-issue pipeline is one SQL query here."

**Act 3 (30s) — the agent introspects itself.** Trigger a fail in the
chat agent, ask "what's been going wrong?". Agent calls
`get_self_improvement_digest` → returns the markdown report. Concrete
rows like `tpl-fetch-url → empty_result × 15`.

## What's verified live

```
Volume in Logfire right now:
  task_classified           — 200+ rows
  task_classified_llm       —  20+ rows with rationales
  retrieved_doc             — 100+ rows
  failure_mode              —  20+ rows

30+ distinct (intent × outcome × context × tokens) chip combos
12 doc → failure_mode correlations available for the heatmap
7 distinct failure modes tagged
5 industry tags / 5 task-types / 6 frictions / 5 experiences / 5 qualities
```

## What still needs human action

| Item | Time | Owner |
|---|---|---|
| Pin the SQL panels as a Logfire dashboard | ~5 min UI | you |
| (Optional) configure the high-severity alert | ~5 min UI | you |
| (Optional) implement `api_logfire.py` re-queue body | ~4 hours | follow-up |

## Bonus findings during build

- `pylf_v2_*` token format wasn't handled in `log.py`'s region map
  before — silent EU fallback would 401 silently. Fixed.
- Logfire's Query API returns column-oriented JSON (not row-oriented).
  Documented in `query_logfire` parser.
- `start_timestamp` is the records column, not `timestamp`. Updated
  everywhere.
- Logfire **auto-scrubs** values containing "auth" — paths like
  `best_practices/auth.md` show as `[Scrubbed due to 'auth']`. Worth
  name-dropping as a security feature in the demo.

## Commits on this branch

```
b67992d  feat(digest): self-improvement report + new MCP tool
a03f388  feat(llm-tagger): Cody-shape semantic classifier via OpenRouter
8d4f88e  feat(observability): rich tag chips + Cody-style trace classifier
6983b50  fix(observability): Query API parsing + schema column
b23beec  test: seed_demo_traces.py
1d289e0  feat(observability): logfire-driven self-improvement loop (A+B)
```

## Roll-back

Drop the branch. No prod state changes outside `.env` (which you
control). `microbots_lm/` doc additions are non-code, also reversible.
