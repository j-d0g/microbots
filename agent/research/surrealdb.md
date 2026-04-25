# SurrealDB v2 for Microbots — Research Brief

Research agent: R6 · Date: 2026-04-24 · Scope: live queries, HNSW vector, hybrid search, Python + JS SDKs, multi-tenancy, migrations, gotchas.

## TL;DR

Strong fit for the microbots spine: one Docker process gives graph + document + vector + FTS + WebSocket live queries from a single SurrealQL statement. Iframe opens `wss://`, runs `LIVE SELECT`, receives pushes natively. HNSW supports 1536/3072-dim vectors with COSINE/EUCLIDEAN/MANHATTAN, and `search::rrf()` fuses FTS + vector scores in one query. Sharp edges: live queries are **single-node only** in v2, JS live API is the polished one (Python is workable but rougher), browser auth wants `DEFINE ACCESS … TYPE RECORD` + short-lived JWTs, migrations are roll-your-own SurrealQL. For v0 multi-tenancy, **row-level `owner` + table PERMISSIONS** beats namespace-per-user — keeps the playbook (cross-user) layer trivially queryable. Hackathon-safe.

---

## 1. Live queries — subscription model

WebSocket-only. Browser opens `wss://host/rpc`, authenticates, then runs either `db.live(<table>)` (managed — SDK auto-resubscribes on reconnect) or `LIVE SELECT … FROM t WHERE …` (unmanaged — UUID returned, subscribe to it). Notifications are JSON-RPC pushes: `{ action: 'CREATE'|'UPDATE'|'DELETE', result: <record-or-id> }`. Default mode pushes the full record on CREATE/UPDATE, just the ID on DELETE; `LIVE SELECT DIFF` switches to JSON-Patch deltas. Filter with `WHERE`, expand edges via `FETCH` (v2.2+). Stop with `KILL <uuid>` or `live.kill()`.

Constraint: **single-node only in v2** — fine for one Docker container. Notifications only fire on committed transactions; same-client order is preserved, cross-client is best-effort.

## 2. HNSW vector index

```sql
DEFINE INDEX node_embed ON node
  FIELDS embedding
  HNSW DIMENSION 1536 TYPE F32
  DIST COSINE
  M 12 EFC 150;
```

- **TYPE**: F64 (default in older docs; F32 is now standard), F32, I64, I32, I16 — pick F32 for OpenAI 1536-dim embeddings to halve memory.
- **DIST**: EUCLIDEAN, COSINE, MANHATTAN, MINKOWSKI.
- **DIMENSION**: validated to 1536 (OpenAI small) and 3072 (OpenAI large) in published examples; no hard upper limit documented.
- **M / EFC**: graph degree (default 12) and construction-time exploration (default 150). M0 and LM auto-derived.
- **CONCURRENTLY / DEFER**: build index without blocking writes / accept eventual consistency.

KNN query has two forms:

```sql
-- HNSW indexed (number after K = ef, dynamic candidate-list size at search time)
SELECT id, text FROM node
WHERE embedding <|10,40|> $query_vec;

-- Brute-force (no index needed)
SELECT id, text FROM node
WHERE embedding <|10,COSINE|> $query_vec;
```

HNSW updates incrementally on insert/update — no rebuild required, suitable for the live ingest path microbots needs.

## 3. Hybrid search — FTS + vector + graph in one query

Stack the modalities in a single `SELECT`. Pattern:

```sql
DEFINE ANALYZER snowball_en TOKENIZERS class FILTERS lowercase, snowball(english);
DEFINE INDEX node_text ON node FIELDS text FULLTEXT ANALYZER snowball_en BM25 HIGHLIGHTS;
DEFINE INDEX node_vec  ON node FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- Hybrid: FTS score + vector distance + 1-hop graph expansion
SELECT
  id,
  text,
  search::score(0)                   AS lex_score,
  vector::similarity::cosine(embedding, $q_vec) AS vec_score,
  ->mentions->concept.*              AS concepts
FROM node
WHERE text @0@ $query_text
   OR embedding <|20,40|> $q_vec
ORDER BY search::rrf(lex_score, vec_score) DESC
LIMIT 10
FETCH concepts;
```

`search::rrf()` is the recommended fusion (Reciprocal Rank Fusion) over manual weighting. Graph traversal (`->edge->target`) and vector + FTS coexist in the same statement — this is SurrealDB's signature win for an IoA-style playbook layer.

## 4. Python SDK (`surrealdb` on PyPI)

- `pip install surrealdb`; Python ≥ 3.10. Mature enough to ship, rougher than JS.
- `Surreal` (sync) and `AsyncSurreal` (async) — same methods. Use WebSocket (`ws://`/`wss://`) for live queries, sessions, transactions; HTTP raises `NotImplementedError` for those.
- Live query shape:

```python
from surrealdb import AsyncSurreal

async with AsyncSurreal("ws://localhost:8000/rpc") as db:
    await db.signin({"username": "root", "password": "root"})
    await db.use("microbots", "main")

    qid = await db.live("node")  # or: (qid,) = await db.query("LIVE SELECT * FROM node WHERE owner = $auth.id")
    async for n in db.subscribe_live(qid):
        # n = {"action": "CREATE"|"UPDATE"|"DELETE", "result": {...}}
        handle(n)
    await db.kill(qid)
```

Migrations: no Alembic-equivalent. Pattern: `migrations/NNN_*.surql` of idempotent `DEFINE … IF NOT EXISTS` / `OVERWRITE`, applied via `db.query(open(p).read())` on boot, tracked in a `_migrations` table.

**Gotchas:** older docs show `db.live_notifications(uuid)`; current API is `subscribe_live(uuid)`. URL must include `/rpc`. Datetime + Decimal need SDK wrapper types in query comparisons.

## 5. JavaScript SDK (`surrealdb` on npm, v2.x)

- `npm i surrealdb`. Browser/Node/Deno/Bun. ESM + tree-shakeable; no published bundle-size figure.
- Auth: root `{ username, password }`, NS/DB users, or **record access via `DEFINE ACCESS … TYPE RECORD`** with `db.signin({ access: 'user', … })` → JWT. For iframe: backend mints short-lived JWT (≤1h default), iframe calls `db.authenticate(token)`. Anonymous reads possible via unauth-scope PERMISSIONS but skip for v0 — gate everything.
- Live queries (managed):

```ts
import Surreal, { Table, gt } from 'surrealdb';

const db = new Surreal();
await db.connect('wss://surreal.microbots.local/rpc', {
  namespace: 'microbots', database: 'main',
});
await db.authenticate(jwtFromBackend);

const live = await db.live(new Table('node'))
  .fields('id', 'kind', 'text', 'updated_at')
  .where(gt('updated_at', $since));

live.subscribe((action, result, record) => {
  // action: 'CREATE' | 'UPDATE' | 'DELETE'
  applyToGraphView(action, result ?? record);
});

// or: for await (const { action, value } of live) { ... }
await live.kill();
```

Managed live queries auto-restart on reconnect — important for flaky iframe networks. Unmanaged path: `db.query('LIVE SELECT …')` → `db.liveOf(id).subscribe(...)`.

## 6. Multi-tenancy patterns

Three options, ranked for v0:

1. **Row-level `owner` + table PERMISSIONS (recommended).** One ns/db. Every node/edge has `owner: record<user>`. `DEFINE TABLE node PERMISSIONS FOR select, update, delete WHERE owner = $auth.id, FOR create WHERE $auth.id != NONE;`. Playbook tables read via `PERMISSIONS FULL`, write via service-role JWT. User graph + playbook are queryable and live-subscribable from one connection.
2. **Database-per-user.** Strong isolation but live queries can't span databases — playbook becomes painful.
3. **Namespace-per-user.** Strongest isolation, same cross-tenant pain as (2), worse. Enterprise tier later.

Pick (1).

## 7. Schema migration story

No first-party tool. Pattern:

- Versioned `*.surql` files using `DEFINE … OVERWRITE` or `DEFINE … IF NOT EXISTS`.
- Wrap risky changes in `BEGIN; … COMMIT;`.
- Destructive changes: `UPDATE t SET new = old; REMOVE FIELD old ON t;`.
- HNSW rebuild: `REMOVE INDEX …; DEFINE INDEX … CONCURRENTLY;`.
- Track in same transaction: `CREATE _migration:'001' SET applied_at = time::now();`.
- Don't `DEFINE TABLE … SCHEMAFULL OVERWRITE` on a populated prod table without a backup — it resets the table.

## 8. Edge cases / gotchas at hackathon speed

- **Live queries single-node only in v2.** Don't plan a clustered Surreal until v3.
- **Connection URL footgun**: must end in `/rpc` for both Python and JS. `ws://localhost:8000` alone will return 404-style errors on subscribe.
- **Live query reordering across clients.** Don't treat the stream as a totally ordered log — use `updated_at` for last-write-wins on the iframe side.
- **HNSW EF parameter**: too low (`<10`) gives bad recall; too high kills latency. Start at 40, tune.
- **JWT expiry**: default 1h. Browser must refresh proactively or `db.authenticate()` will start failing mid-session.
- **Permissions default to NONE for record users.** If the iframe gets "no records returned" on a query you know has data, it's almost always missing `PERMISSIONS FOR select WHERE …`.
- **Float vs Decimal**: numbers default to F64; `decimal` type exists but isn't auto-coerced. Use `<decimal>` casts where money-grade matters.
- **`fetch` over deep graphs in live queries** (v2.2+) is convenient but every push re-runs the fetch. Keep depth ≤ 2.
- **Embedding ingest order**: insert the row first, then the embedding update — HNSW will index the update correctly. Inserting both in one `CREATE` works too; just be consistent.

---

## Recommendation: microbots iframe ↔ DB sync

- Python/FastAPI backend owns auth: validates session, mints short-lived SurrealDB JWT via `DEFINE ACCESS user TYPE RECORD … DURATION FOR TOKEN 30m`.
- Iframe calls `/surreal-token`, gets `{ token, ns, db, wsUrl }`, then `new Surreal()` → `connect(wsUrl)` → `authenticate(token)` → two managed live queries (nodes + relations) drive the entire graph view.
- All mutations go through Python (owns embedding gen, validation, IoA promotion). Iframe is read-mostly + UI events.
- Python keeps its own long-lived `AsyncSurreal` connection for ingest and for the playbook writer (service-role JWT).

Net: **one WebSocket per iframe, two live subs, push-driven UI, no polling** — same SurrealDB instance is the spine for both layers.

## Recommendation: multi-tenancy in v0

Single namespace `microbots`, single database `main`. Every user-scoped table has `owner: record<user>` + a PERMISSIONS clause keyed off `$auth.id`. Playbook tables (`pb_pattern`, `pb_relation`) live alongside with `PERMISSIONS FOR select FULL, FOR create, update, delete WHERE $auth.id IN $service_principals` — backend writes distilled patterns, every authenticated user reads them. Makes the IoA stretch goal a 30-line backend job, not a cross-database join. Promote a customer to namespace-per-tenant only if hard isolation is later required.

---

## Sources

- [LIVE SELECT statement](https://surrealdb.com/docs/surrealql/statements/live)
- [DEFINE INDEX statement (HNSW + FULLTEXT)](https://surrealdb.com/docs/surrealql/statements/define/indexes)
- [JavaScript SDK — live queries](https://surrealdb.com/docs/sdk/javascript/concepts/live-queries)
- [Python SDK — overview](https://surrealdb.com/docs/sdk/python)
- [Python SDK — live queries](https://surrealdb.com/docs/sdk/python/concepts/live-queries)
- [Vector model](https://surrealdb.com/docs/surrealdb/models/vector)
- [Authentication / DEFINE ACCESS](https://surrealdb.com/docs/surrealdb/security/authentication)
- [Namespace concept](https://surrealdb.com/docs/surrealdb/introduction/concepts/namespace)
- [Multi-tenant RBAC blog series (Sebastian Wessel, dev.to)](https://dev.to/sebastian_wessel/series/24535)
- [Semantic search with SurrealDB and OpenAI](https://surrealdb.com/blog/semantic-search-with-surrealdb-and-openai)
- [Beyond basic RAG on SurrealDB](https://surrealdb.com/blog/beyond-basic-rag-building-a-multi-cycle-reasoning-engine-on-surrealdb)
