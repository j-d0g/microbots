# microbots/ — observability layer

Central package for everything observability-shaped. Every other
subsystem (app/, agent/, knowledge_graph/) imports from here rather
than calling Logfire directly, so we can evolve the substrate
without spraying changes.

## Modules

| File | Public surface | When to touch |
|---|---|---|
| `log.py` | `setup_logging`, `span`, `get_logger`, `instrument`, `get_correlation_id` | bootstrap / region routing |
| `observability.py` | `traced_retrieval`, `record_retrieval`, `emit_failure_mode`, `instrument_pydantic_ai`, `instrument_fastapi`, `instrument_httpx`, `query_logfire`, `KNOWN_FAILURE_MODES` | adding instrumentation to a new tool / module |
| `tagger.py` | `classify_recent_traces`, `derive_classification`, `TAXONOMY` | extending the rule-based dim set |
| `llm_tagger.py` | `tag_recent_traces`, `classify_with_llm`, `TAXONOMY` | extending the Cody-shape semantic taxonomy |
| `digest.py` | `collect_digest`, `render_markdown` | adding new sections to the self-improvement report |

## Operating rules

- **Always go through `microbots`** — never `import logfire` directly
  in app / agent / kg code. The wrapper handles config, region
  routing, and idempotency.
- **Tag every retrieval.** Anything that pulls a doc, code template,
  memory row, RAG chunk, etc. into the LLM context must wrap with
  `traced_retrieval` (or `record_retrieval` for hot loops). The
  doc-attribution dashboard is meaningless without this coverage.
- **Tag every failure.** Every error path of every tool / agent
  emits `emit_failure_mode(label, severity=...)`. Free-form labels
  are allowed but please reuse `KNOWN_FAILURE_MODES` first — the
  dashboard's `GROUP BY label` relies on the canonical set.
- **Idempotent instrumentation.** `instrument_*` functions are safe
  to call from every entry point; they no-op after the first call.
  Prefer top-of-module over lifespan hooks so the SDK is configured
  before any other span is opened.

## Adding a new dimension to the rule-based tagger

1. Add the dim + values to `TAXONOMY` in `tagger.py`.
2. Add the rule in `derive_classification` that picks a value from
   the spans of one trace.
3. Re-run `uv run python -m microbots.tagger` to backfill.
4. Add the corresponding chip to the LLM-tagger's TAXONOMY too if
   it's also a semantic concept.

## Adding a new dimension to the LLM tagger (Cody-shape)

1. Add the dim + values to `TAXONOMY` in `llm_tagger.py`.
2. The system prompt's heuristics block should mention when to use
   it — short, paraphrasable for the LLM.
3. Re-run `uv run python -m microbots.llm_tagger` to backfill.

## Verification

```sh
# unit
uv run python -m pytest test/test_observability.py -q

# end-to-end (write → ingest → query → JOIN)
uv run python test/verify_logfire_e2e.py

# demo seeding (optional, for visual check in UI)
uv run python test/seed_demo_traces.py
sleep 10
uv run python -m microbots.tagger 5
uv run python -m microbots.llm_tagger 5 12
```

## Read-side dependencies

`query_logfire`, the `inspect_*` MCP tools, the digest, and both
taggers all need `LOGFIRE_READ_TOKEN` in env. Without it they
fail-soft with a clear error string. Generate at Logfire UI →
Project → Settings → Read tokens (separate from Write tokens).
