# kaig (Martin) — Research Notes for microbots

## TL;DR
kaig models a Unix-style filesystem as **one flat `file` SurrealDB table** where the `path` field is a *computed* string built from `parent.path + "/" + filename`. Folders are zero-byte rows with `content_type = "folder"`. The agent gets pydantic-ai bash-like tools (`cat`, `ls`, `write_file`, `edit`, `mkdir`) plus a `retrieve` vector-search tool. The Svelte UI subscribes via `db.live(Table('file'))` over WebSocket for instant tree updates. Worth porting: the computed-path trick, edit/cat/ls tool surface, and live-query subscription pattern.

## kaig architecture

- **Repo shape**: Python lib (`src/kaig/` — DB wrapper, embeddings, LLM, flow executor) + `kaig-app/` SvelteKit frontend + `examples/knowledge-graph/` (the pydantic-ai agent demo).
- **Runtime**: agent built with `pydantic-ai`'s `Agent` + `FunctionToolset`, served via `agent.to_web(...)`. `opencode.json` is just `{"instructions": [".cursor/rules/*.md"]}` — opencode is the editor harness, not the agent runtime.
- **DB layer**: `kaig.db.DB` wraps SurrealDB sync+async clients, exposes `apply_schemas`, `query`, `vector_search_from_text`, `relate`, `recursive_graph_query`, `graph_query_inward`, `graph_siblings`, `embed_and_insert(_batch)`.
- **Schema**: `vector_tables=[VectorTableDefinition("document", "COSINE"), ...]` and `graph_relations=[Relation("has_keyword", "document", "keyword"), ...]` declared in Python, materialised as SurrealQL `DEFINE TABLE` + HNSW indexes via `.surql` templates in `src/kaig/db/surql/`.
- **Filesystem table** (`kaig-app/migrations/V5__files.surql`):
  ```
  file SCHEMAFULL
    owner: record<user> (auth-scoped)
    filename: string
    parent: option<record<file>>           -- recursive self-ref
    content_type: string                    -- "folder" | "text/markdown" | "text/html" | ...
    file: option<bytes>; content: option<string>; symlink: option<file>
    path: COMPUTED ($this.parent.path || '') + '/' + filename
    flow_chunked, flow_keywords: option<string>   -- ETL stamps
    created_at, updated_at, deleted_at
  ```
  Folders are just rows where `file/content/symlink` are all NONE. `path` is computed (no manual maintenance, rename-safe). Per-row row-level auth via `PERMISSIONS … WHERE owner = $auth.id`.
- **Event hooks** (`V8__file_delete_event.surql`): `DEFINE EVENT file_deleted ON file WHEN $event = 'DELETE' THEN { DELETE chunk WHERE doc = $before.id; … }` — cascade cleanup runs in-DB.

## Tool surface

All tools live in `examples/knowledge-graph/tools/fs.py`, registered as a `FunctionToolset[Deps]`. Each is async, takes `RunContext[Deps]`, and uses pydantic `BaseModel` argument classes for typed schemas surfaced to the LLM.

| Tool | Args | Behaviour |
|---|---|---|
| `cat` | `path` | `SELECT * FROM ONLY file WHERE path = $path LIMIT 1`; returns `content` or "File not found"/content-type error string. |
| `ls` | `path`, `all`, `long`, `recursive`, `dir_only`, `human` | `string::starts_with(path, $prefix)` query, then path-prefix walk in Python to synthesise dir/file rows. Returns formatted text. |
| `write_file` | `path`, `content` | Splits path, walks ancestors, auto-creates folder rows, then `CREATE` or `UPDATE` `file`. Auto-detects content_type from leading bytes. Resets `flow_chunked`/`flow_keywords` and deletes downstream `chunk`s. |
| `edit` | `path`, `old`, `new`, `replace_all` | Like Claude's `Edit` tool — load content, `current.replace(old, new[, 1])`, write back, invalidate chunks. Raises if `old` not found. |
| `mkdir` | `path`, `parents` | Walks segments, errors if a segment exists as a file, creates folder rows otherwise. |
| `retrieve` | `search_query` | Embeds query, runs `surql/search_chunks.surql` (vector search over chunks joined to `file`), returns `# Document name: …\n…` formatted blob. |
| `query_ecomm` | (varies) | Separate `build_ecomm_toolset()` for the demo's product/order graph. |

Key idioms: error returned as **string** for not-found (not an exception) so the LLM can self-correct; mutations *invalidate* derived tables (`DELETE chunk WHERE doc = $doc`) so re-embedding picks up changes; all tools accept absolute or relative paths, normalised with `if not path.startswith("/"): path = "/" + path`.

## System prompt patterns

From `examples/knowledge-graph/agent.py`:

> "You are a helpful assistant with access to a file system to store notes and preferences. Every time you learn something about my preferences, store it in a file in the /preferences folder. For example, create files like /preferences/brand.md, /preferences/tone-and-voice.md… Write your main notes in /memory/main.md, and read them every time we interact. Before you answer, consider updating the /memory/main.md file with your latest thoughts and insights that you need to always remember. Keep it short and to the point. Notes that may be useful in the future, but are not critical, can be stored in individual files according to their topic… Use the `retrieve` tool to search in files…"

Pattern moves:
1. **Path conventions encoded in the prompt** — `/preferences/<topic>.md`, `/memory/main.md`, `/memory/<topic>.md`.
2. **Pre/post hooks as instructions** — "read main.md every time we interact", "consider updating main.md before answering".
3. **Tool routing** — explicitly tells the LLM which tool to use for which class of question (`retrieve` for search, `query_ecomm` for product data).
4. No hand-rolled memory engine: the LLM is the curator, the FS is the substrate.

## Live-query UI sync mechanism

Pure SurrealDB WebSocket live queries — no extra pubsub layer.

- `kaig-app/src/lib/surreal.ts`: cached `Surreal()` connection, `connect(ws://…/rpc)`, `db.use({namespace, database})`, `db.authenticate(jwt)`. JWT is minted by the SvelteKit backend (`/api/auth/login`); the browser holds it and uses it directly against SurrealDB.
- `kaig-app/src/lib/components/app-sidebar.svelte`: inside a Svelte 5 `$effect`:
  1. Initial `db.query<[FileRecord[]]>('SELECT … FROM file WHERE deleted_at = NONE ORDER BY path ASC')`.
  2. `subscription = await db.live<FileRecord>(new Table('file'))`.
  3. `subscription.subscribe((message) => { CREATE → prepend; UPDATE → splice; DELETE → filter })`.
  4. Cleanup: `subscription.kill()` on effect teardown.
- The path prefix tree is rebuilt client-side from the flat list (`buildTree(files)`), so live-query diffs naturally reflow the tree.
- Auth flows directly: row-level `PERMISSIONS WHERE owner = $auth.id` means the live query is per-user without any backend filter.

## Patterns already in microbots vs gaps to close

| Concept | microbots today | kaig | Gap |
|---|---|---|---|
| Markdown FS for agent memory | `memory/` on disk (user.md, integrations/agents.md, …) read by agents | DB-backed `file` table, agent tools mutate it live | microbots is read-only-ish, FS-backed; no live tool surface |
| Layered navigation index | `layer_index` table + `drills_into` relation + `markdown_path` | implicit via path prefix | microbots is *richer* on the index side; kaig is richer on the *content* side |
| Path-as-identity | n/a (filesystem path on disk) | `path` COMPUTED FIELD on `file` row | could mirror this if we move memory into Surreal |
| Cascading cleanup | n/a explicit | `DEFINE EVENT … ON DELETE` with `DELETE chunk WHERE doc = $before.id` | adopt for graph hygiene |
| Live UI sync | none yet | `db.live(Table('file'))` over WS w/ JWT | adopt directly when UI ships |
| Vector search over memory | not wired | `retrieve` → search_chunks.surql, HNSW COSINE | wire when chunking pipeline lands |
| Agent tool surface | bash via shell, no FS-over-DB | typed pydantic-ai `cat/ls/edit/write/mkdir` | adopt verbatim shape |
| Schema auto-apply | hand-written `.surql` migrations | Python `DB.apply_schemas()` driving templated `.surql` | could borrow for schema-from-code |
| Auth scoping | not enforced at row level | `PERMISSIONS WHERE owner = $auth.id` | adopt before multi-user |

## Recommendation: what to port

1. **Computed `path` field pattern** — if/when microbots moves any markdown layer into SurrealDB (e.g. mirror `agents.md` files as a `note` table), replicate `path COMPUTED ($this.parent.path || '') + '/' + filename`. Rename-safe, no manual reindex.
2. **Agent tool surface** — port `cat`, `ls`, `edit`, `write_file`, `mkdir` interfaces as-named (LLMs already know them from Claude/Cursor). Keep error-as-string convention. The pydantic `BaseModel` arg classes give clean tool schemas.
3. **Prompt convention** — codify path conventions in the system prompt: `/preferences/<topic>.md`, `/memory/main.md`, "read main.md first, update before answering". Aligns with microbots' existing `memory/` hierarchy (`user.md` is already the analogue of `main.md`).
4. **Live query for UI** — when the inspector/UI exists, use `db.live(Table('memory_node'))` over WS with JWT auth; build trees client-side from flat `path` lists. No need for a separate pubsub.
5. **`DEFINE EVENT … ON DELETE`** — for `layer_index` and any chunk/embedding tables, mirror kaig's cascade events so deletion of a parent invalidates derived rows in-DB.
6. **Stamp pattern (`flow_chunked`, `flow_keywords`)** — option<string> stamps on the row record which ETL stage processed it; null stamp on edit triggers reprocessing. Cheap idempotency without a job queue table.

What microbots already has and shouldn't replace: `layer_index` + `drills_into` is a richer navigation/cost-aware index than kaig's implicit prefix tree — keep it, it's the differentiator. kaig is not opinionated about *layered context* the way microbots is.

What kaig does that microbots does not yet need: vector search over chunks, knowledge-graph keyword extraction, file upload + Kreuzberg parsing. Defer until there's content volume to justify it.
