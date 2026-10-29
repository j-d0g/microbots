# Knowledge graph

```text
Composio connected apps ─┐
                        ├─ ingest: pull → dedup → triage → chats + integration metadata
tests/fixtures/train ───┘                                │
                       enrich: memories + entities → skills → workflows
                                                        │
                       wiki: graph slices → validated wiki_page markdown
                                                        │
                       SurrealDB ← FastAPI /api/kg/* ← web Graph view
```

All paths use the same schema and writers. `make dev` only applies schema and seeds
the demo: it does **not** ingest or call LLMs. `app/` has its own query/writer layer;
it imports no KG runtime modules, but its tests use `schema/*.surql`.

| Command | Keys / behavior |
| --- | --- |
| `make db-up db-schema db-seed` | None; Docker SurrealDB v2, schema, seeded demo |
| `make ingest-demo` | None; fixture pullers + explicit deterministic offline/demo model |
| `make ingest ARGS='-i slack'` | Composio + connected account, OpenRouter **or** Anthropic |
| `make ingest ARGS='--from-fixtures'` | OpenRouter **or** Anthropic only; real extraction on fixtures |
| `make wiki` | OpenRouter, Anthropic, or the configured OpenAI model/key |
| `KG_LLM_MODE=offline make wiki` | None; deterministic wiki from live DB graph slices |
| `make wiki-cat P=tree` / `P=user.md` | None; list/read stored wiki pages |
| `make test` / `make e2e` | SurrealDB; no keys (two live wiki tests skip) |
| `make synth-corpus` / `make surface` | None; regenerate fixtures / surface candidates |
| `make db-reset` | None; **destructively resets** local DB volume and restores seed |

Start with `cp -n .env.example .env`, then `make db-up ingest-demo`. Use `make dev`
for the API (:8001) and web (:3000); it seeds demo rows alongside fixture rows.
`make ingest-demo` never resets the DB. Reruns deduplicate by source ID. For live
ingest, set keys in `.env`, then connect apps with `composio login` / `composio link
slack` (or github/gmail/linear/notion/perplexityai) for `COMPOSIO_USER_ID`.

The two committed golden files validate stored triage/memory output schemas; they
do not cover a complete run or implement recording. `offline.py` supplies labeled,
schema-valid demo outputs through Pydantic AI's no-network `TestModel`. It retains
all fixture items at mid signal, groups source types into demo skills/workflows,
and renders bounded graph excerpts—not learned insights or quality evaluation.
Real extraction still uses the original prompts and providers. Verify with
`uv run pytest -q`; all DB tests use isolated test databases, not `memory`.

[Reachability and Makefile target audit](TARGETS.md). The old `.devin/RULES.md`
self-tuning instructions refer to retired eval CLIs; retained eval helpers are
regression-tested scoring functions, not an autonomous prompt-optimization loop.
