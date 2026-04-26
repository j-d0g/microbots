# 03 — kg_mcp recon and `search_memory` wiring decision

## TL;DR

Wired V1. `search_memory(scope="kg" | "all", query=...)` proxies to kg_mcp's
`kg_memories_top` tool over streamable-HTTP MCP, then substring-filters the
result by `query` and returns the top-N matches. `scope="recent_chats"` stays
a stub (no chat-summary pipeline yet). Total wiring: ~45 LOC inside the
`search_memory` body, no other tools touched, no new top-level imports
beyond the `mcp.client.streamable_http` import block which lives inside the
function for lazy loading.

## kg_mcp surface (live)

- **Source:** `app/services/kg_mcp/main.py` on `main` (commit `259cb79`).
- **Deployment:** `https://kg-mcp-2983.onrender.com/mcp` (Render free tier;
  ~30s cold start after 15min idle; `/health` wakes it).
  - **Live status at recon time (2026-04-26):** `GET /health` → 404,
    `POST /mcp` → 404. Service appears to be down or the URL has rotated.
    The graceful-degradation branch in `search_memory` handles this; tool
    returns `{"results": [], "error": "kg_mcp unreachable: ..."}` rather
    than crashing. P3: confirm with Daud whether the URL has moved or the
    service was decommissioned post-hackathon.
- **Transport:** streamable HTTP (POST + SSE). MCP JSON-RPC envelope.
- **Auth:** NONE. Single-tenant for the hackathon. No bearer / signed
  request. The URL itself is the only access control.
- **13 tools available**, all read-only / idempotent, all returning
  JSON-encoded strings (because SurrealDB native types don't round-trip
  through FastMCP's pydantic validator).

### Most relevant tools for `search_memory`

| Tool                 | Args                              | Returns                      |
|----------------------|-----------------------------------|------------------------------|
| `kg_memories_top`    | `by: "confidence"\|"recency"`, `limit: 1..200` | List of memory rows: `{id, content, confidence, created_at, ...}` |
| `kg_entities_by_type`| `entity_type: str`                | Entities of one type. Requires knowing the type first. |
| `kg_wiki_page`       | `path: str`                       | Markdown of one wiki page. Requires path. |

**There is no free-text `search_kg` / `query_graph` tool.** The query layer
is named SurrealQL behind the MCP boundary, not a search index. So
"search by query string" has to be approximated client-side.

## Decision

**WIRE `scope="kg"` and `scope="all"` to `kg_memories_top`, filter by
query substring, and return the top-K matches.** Keep `scope="recent_chats"`
stubbed.

Rationale:

1. Memories are the highest-signal distilled facts in the graph (confidence
   ≥ 0.5, hand-curated by the enrichment pipeline). They're exactly what an
   agent wants when grounding "what does the user prefer / who do they work
   with / what are their conventions" — i.e. the `search_memory` use case.
2. Substring matching against `content` is crude but honest for V1, and
   gracefully returns *something useful* even when the query doesn't hit
   (we just return the top memories ungrounded — caller still gets context).
3. Real ranked search (BM25 / vector) would need either (a) a new MCP tool
   on the kg_mcp server, or (b) a SurrealDB FTS index — and FTS is currently
   disabled (Surreal v3 syntax change, per docs). Both are P3.

Alternatives considered & rejected:

- **Direct SurrealDB query:** would couple the agent harness to schema +
  credentials; defeats the MCP boundary. Rejected.
- **Skip wiring entirely, keep stub:** wastes a live resource that's already
  deployed and unauthenticated. Wiring is cheap. Rejected.
- **Wire `kg_entities_by_type` instead:** requires guessing `entity_type`
  from a free-text query, which is a NL-classification problem. Heavier
  than V1 budget. Rejected.

## LOC estimate (actual)

~45 LOC inside `search_memory`, including:

- 4 LOC import (lazy, inside function): `from mcp import ClientSession`,
  `from mcp.client.streamable_http import streamablehttp_client`, plus
  `import json, asyncio` (already module-level).
- 6 LOC: `kg=` short-circuit when scope is `recent_chats`.
- 15 LOC: streamable-HTTP session + `call_tool("kg_memories_top", ...)`.
- 10 LOC: parse JSON, substring-filter, build result rows.
- 8 LOC: try/except → graceful `{results: [], error: "kg_mcp unreachable"}`.

No changes to other tools. No new top-level imports.

## Env vars added

- `KG_MCP_URL` — defaults to `https://kg-mcp-2983.onrender.com/mcp` if unset.
  Override for local kg_mcp testing (e.g. `http://localhost:9001/mcp`).
- `KG_MCP_API_TOKEN` — read but unused today (kg_mcp has no auth). Plumbed
  in so a future Authorization header is a one-liner.

These need adding to:

- `agent/harness/mcp/.env.example` (if it exists) — V1 docs follow-up.
- The Render deploy env for the harness MCP service — P3.

## Response contract preserved

```python
{
  "results": [
    {"source": "kg:memory:<id>", "scope": "kg", "snippet": "<content>", "score": <confidence>},
    ...
  ],
  "query": "<echo>",
  "scope": "<echo>",
}
```

On graceful degradation: `{"results": [], "query": ..., "scope": ..., "error": "kg_mcp unreachable"}`.

## What's left for P3

1. **Real ranked search.** Add an FTS or vector tool on the kg_mcp side
   (e.g. `kg_search(query, top_k)`) — Surreal HNSW already works, FTS needs
   a v3 syntax fix. Then `search_memory` swaps the `kg_memories_top` call
   for `kg_search`, no other changes.
2. **`scope="recent_chats"`.** Build the chat-summary rolling-window
   pipeline. Out of scope for V1 entirely.
3. **Auth.** kg_mcp is currently unauthenticated. Before V1 ships to more
   than one tenant we need a bearer token check on the kg_mcp side and the
   `KG_MCP_API_TOKEN` env wired through here.
4. **Caching.** Today every `search_memory` call hits kg_mcp (and may eat a
   30s cold-start tax). Add a per-process LRU on `(scope, query)` once we
   have real traffic data.
5. **Wake probe.** Optionally hit `/health` before `call_tool` so the user
   sees "warming up..." rather than a 30s blocking call. P3 polish.
