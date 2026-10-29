# Knowledge graph

```text
Composio connected apps ─┐
                        ├─ ingest: pull → dedup → triage → chats + integration metadata
tests/fixtures/train ───┘                                │
                       enrich: memories + entities → skills → workflows
                                                        │
                       wiki: graph slices → validated wiki_page markdown
                                                        │
                       SurrealDB ← FastAPI /api/kg/* ← chat results
```

All paths use the same schema and writers. `make dev` only applies schema and seeds
the demo: it does **not** ingest or call LLMs. `app/` has its own query/writer layer;
it imports no KG runtime modules, but its tests use `schema/*.surql`.

| Command | Keys / behavior |
| --- | --- |
| `make dev` | None; installs dependencies, starts SurrealDB v2, applies schema and seeds demo |
| `make ingest-demo` | None; fixture pullers + explicit deterministic offline/demo model |
| `make test` | SurrealDB; pytest + web typecheck/Vitest; live wiki tests skip without keys |
| `make surface` | None; surface candidates from the current graph |
| `make db-reset` | None; **destructively resets** the local DB and restores seed |

Start with `cp -n .env.example .env`, then `make ingest-demo`. Use `make dev`
for the API (:8001) and web (:3000); it seeds demo rows alongside fixture rows.
`make ingest-demo` never resets the DB. Reruns deduplicate by source ID. For live
ingest, set keys in `.env`, then connect apps with `composio login` / `composio link
slack` (or github/gmail/linear/notion/perplexityai) for `COMPOSIO_USER_ID`.

## Pipeline commands

Run from the repository root after copying `.env.example` to `.env`. The default
`KG_LLM_MODE=offline` uses labeled deterministic demo outputs, including wiki
generation. Live extraction requires `KG_LLM_MODE=live` and OpenRouter or Anthropic
keys (plus Composio for connected apps); live wiki can also use its configured
OpenAI model/key.

```bash
export PYTHONPATH="$PWD:$PWD/knowledge_graph"
make db-up
uv run python knowledge_graph/schema/apply.py
uv run python knowledge_graph/seed/seed.py
uv run python -m wiki
uv run python knowledge_graph/seed/wiki_cat.py tree  # or user.md
uv run python knowledge_graph/tests/synth/generate_corpus.py
uv run pytest knowledge_graph/tests/e2e -v
KG_LLM_MODE=live uv run python -m ingest -i slack
KG_LLM_MODE=live uv run python -m ingest --from-fixtures
```

The two committed golden files validate stored triage/memory output schemas; they
do not cover a complete run or implement recording. `offline.py` supplies labeled,
schema-valid demo outputs through Pydantic AI's no-network `TestModel`. It retains
all fixture items at mid signal, groups source types into demo skills/workflows,
and renders bounded graph excerpts—not learned insights or quality evaluation.
Real extraction still uses the original prompts and providers. Verify with
`uv run pytest -q`; all DB tests use isolated test databases, not `memory`.

The [historical entrypoint audit](TARGETS.md) documents the earlier cleanup;
`make help` is the current list of supported shortcuts. Retained eval helpers are
regression-tested scoring functions, not an autonomous prompt-optimization loop.
