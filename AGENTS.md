This is a collaborative repo across 3 members for a hackathon.

agent/ covers Jordan's minimal coding-agent harness work: `agent/scratchpad/` for notes/plans, `agent/harness/` for implementation code.
knowledge_graph/ and everything else here covers the scope of Desmond's knowledge-graph using Composio, PydanticAI, Logfire, and SurrealDB.

UI agent improvement plan (capability sprints, eval-gated): see
`web/agent-evals/AGENTS.md`. Devin Cloud reads that file at the start
of every session and updates the sprint log on every PR.

Local setup/run notes learned 2026-04-25:
- First-run setup: `cp .env.example .env`, then `make db-up`.
- If path-script commands cannot import `microbots`, run them with `PYTHONPATH=$PWD:$PWD/knowledge_graph` from the repo root.
- `make db-schema` applies schema successfully on current SurrealDB client, but `knowledge_graph/schema/apply.py` may exit with `KeyError: 0` because `db.query("INFO FOR DB;")` returns a dict rather than a list.
- Local seed verification command: `PYTHONPATH=$PWD:$PWD/knowledge_graph uv run python knowledge_graph/seed/wiki_from_seed.py --skip-seed --dry-run` still needs an LLM provider key before constructing the wiki agent. Without secrets, verify DB state with `PYTHONPATH=$PWD:$PWD/knowledge_graph uv run python knowledge_graph/seed/wiki_cat.py tree` and `make test`.
