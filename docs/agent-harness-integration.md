# Agent Harness + Frontend Integration Guide

*For Jordan's agent harness, the frontend dev, and any other client connecting to microbots.*

The whole microbots backend is now **one unified service** at a single URL.
It serves four orthogonal surfaces — pick whichever fits your client:

```
Base URL: https://app-bf31.onrender.com

   /health                       Render's deploy probe; returns 200
   /api/health                   rich liveness — service + Surreal + Composio status
   /api/composio/*               per-user Composio OAuth (POST /connect, GET /connections, GET /toolkits)
   /api/kg/*                     REST mirror of the knowledge-graph queries (great for the frontend)
   /mcp/                         MCP streamable-HTTP transport (great for pydantic-ai / Claude Desktop)
   /docs                         FastAPI Swagger UI
   /openapi.json                 OpenAPI 3.1 spec (machine-readable)
```

The standalone `kg-mcp-2983.onrender.com` service has been **torn down** —
update any references to point at this URL.

---

## TL;DR cheat sheet

| Need to do | Hit |
|------------|-----|
| Frontend: connect a user's Slack | `POST /api/composio/connect` with `{user_id, toolkit:"slack", callback_url}` → open `redirect_url` in popup |
| Frontend: poll connection status | `GET /api/composio/connections?user_id=u_42` |
| Frontend: list all connectable apps | `GET /api/composio/toolkits` |
| Browser/curl: read the graph | `GET /api/kg/{user,integrations,memories,skills,workflows,wiki,…}` |
| pydantic-ai agent: read the graph | `MCPServerStreamableHTTP(url="https://app-bf31.onrender.com/mcp/")` |
| Claude Desktop / Cursor | Add the MCP URL to `mcpServers` config (see below) |

---

## What's in the graph right now

The pipeline ran on 6 synthetic integration fixtures (Slack, GitHub, Linear,
Gmail, Notion, Perplexity) and produced:

| Table | Rows | Source |
|-------|------|--------|
| `user_profile` | 1 | seed (Desmond, AI engineer) |
| `integration` | 6 | triage updated each row's metadata |
| `chat` | 49 | LLM triage of 61 raw items |
| `entity` | 28 | entity resolver merged mentions across integrations |
| `memory` | 40 | memory extractor distilled high-signal facts/preferences |
| `skill` | 19 | skill detector found atomic repeatable behaviours |
| `workflow` | 3 | seeded; composer needs more LLM credit |
| `wiki_page` | 18 (10 with content) | wiki agent populated depth-2/3 pages |

---

## 1. Composio OAuth — the endpoints the frontend wants

Auto-discovered from your Composio dashboard, so we never have to hard-code
`ac_xxx` IDs anywhere on the client side.

### `POST /api/composio/connect`

```http
POST /api/composio/connect
Content-Type: application/json

{
  "user_id":      "u_42",
  "toolkit":      "slack",
  "callback_url": "https://your-frontend.com/oauth/return"
}
```

Returns:

```json
{
  "redirect_url": "https://accounts.composio.dev/oauth/authorize?...",
  "connection_id": "ca_abc123",
  "status": "INITIATED"
}
```

The frontend opens `redirect_url` in a popup or new tab. Composio hosts the
consent screen, completes the OAuth handshake with the provider, then
redirects the user back to `callback_url` with a query string like:

```
?status=success&connected_account_id=ca_abc123&user_id=u_42
```

The frontend can then close the popup and poll `/api/composio/connections`
to confirm the connection went `INITIATED → ACTIVE`.

### `GET /api/composio/connections?user_id=u_42`

```json
{
  "user_id": "u_42",
  "connections": [
    {"toolkit": "slack",  "status": "ACTIVE",    "id": "ca_abc"},
    {"toolkit": "github", "status": "INITIATED", "id": "ca_xyz"}
  ]
}
```

### `GET /api/composio/toolkits`

```json
{
  "toolkits": [
    {"slug": "slack",        "name": "Slack",        "auth_config_id": "ac_..."},
    {"slug": "github",       "name": "Github",       "auth_config_id": "ac_..."},
    {"slug": "gmail",        "name": "Gmail",        "auth_config_id": "ac_..."},
    {"slug": "linear",       "name": "Linear",       "auth_config_id": "ac_..."},
    {"slug": "notion",       "name": "Notion",       "auth_config_id": "ac_..."},
    {"slug": "perplexityai", "name": "Perplexityai", "auth_config_id": "ac_..."}
  ]
}
```

POSTing an unknown `toolkit` to `/connect` returns a `400` with the available list — useful for a render-driven dropdown.

### Frontend pseudo-code

```typescript
// 1. Show available toolkits as buttons
const { toolkits } = await fetch("https://app-bf31.onrender.com/api/composio/toolkits").then(r => r.json());

// 2. User clicks "Connect Slack"
const { redirect_url, connection_id } = await fetch(
  "https://app-bf31.onrender.com/api/composio/connect",
  { method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ user_id: currentUser.id, toolkit: "slack",
                            callback_url: "https://app.example.com/oauth/return" }) }
).then(r => r.json());

// 3. Open popup; the OAuth dance happens server-side
const popup = window.open(redirect_url, "composio-oauth", "width=600,height=700");

// 4. Poll status (Composio redirects user back to callback_url; frontend
//    just keeps polling until status === ACTIVE)
const interval = setInterval(async () => {
  const { connections } = await fetch(
    `https://app-bf31.onrender.com/api/composio/connections?user_id=${currentUser.id}`
  ).then(r => r.json());
  if (connections.find(c => c.toolkit === "slack" && c.status === "ACTIVE")) {
    clearInterval(interval);
    popup.close();
    /* refresh UI */
  }
}, 2000);
```

---

## 2. Knowledge-Graph REST — `/api/kg/*`

The same data the MCP tools serve, exposed as plain JSON for browser clients.
No MCP framing, no JSON-RPC envelope, just `fetch`.

| Path | Returns |
|------|---------|
| `GET /api/kg/user` | Root user profile + aggregate counts |
| `GET /api/kg/integrations` | List of integrations with co-usage edges |
| `GET /api/kg/integrations/{slug}?limit=10` | One integration + entities + top memories + skills |
| `GET /api/kg/entity-types` | Distinct entity types with counts |
| `GET /api/kg/entities?entity_type=person` | All entities of a type |
| `GET /api/kg/entities/{id}` | One entity + edges + recent mentions |
| `GET /api/kg/memories?by=confidence&limit=20` | Top memories |
| `GET /api/kg/skills?min_strength=2` | All skills ≥ threshold |
| `GET /api/kg/workflows` | All workflows + their skill chain |
| `GET /api/kg/chats/summary` | Chat counts grouped by integration + signal level |
| `GET /api/kg/wiki` | Wiki tree (paths + depths, no contents) |
| `GET /api/kg/wiki/{path}` | One wiki page's markdown content |

CORS is open (`allow_origins=["*"]`) for the hackathon — any frontend dev
can hit these from the browser without proxying.

---

## 3. MCP transport — `/mcp/`

For pydantic-ai agents and any MCP-compatible client. 13 tools, all read-only,
all returning JSON-encoded strings.

| Tool | Args | Description |
|------|------|-------------|
| `kg_user_profile` | — | Root user node + aggregate counts. Always call first to seed context. |
| `kg_integrations_overview` | — | Every integration with co-usage edges |
| `kg_integration_detail` | `slug, limit=10` | One integration deep-dive |
| `kg_entity_types` | — | Distinct entity types with counts |
| `kg_entities_by_type` | `entity_type` | Entities of a type with chat-mention counts |
| `kg_entity_detail` | `id` | One entity + which integrations + recent chat mentions |
| `kg_memories_top` | `by, limit` | Top memories by confidence or recency |
| `kg_skills_all` | `min_strength` | Atomic repeatable behaviours |
| `kg_workflows_all` | — | Multi-step workflows + ordered skill chain |
| `kg_chats_summary` | — | Chat counts per integration + signal level |
| `kg_wiki_tree` | — | All wiki paths (no contents) |
| `kg_wiki_page` | `path` | One wiki page's markdown |
| `kg_health` | — | Sanity check + table count |

### pydantic-ai client

```python
import asyncio
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP

kg = MCPServerStreamableHTTP(url="https://app-bf31.onrender.com/mcp/")

agent = Agent(
    "openrouter:google/gemini-2.5-flash",
    mcp_servers=[kg],
    system_prompt=(
        "You are an assistant for Desmond. Before answering, call "
        "`kg_user_profile` to ground yourself, then `kg_memories_top` "
        "and any other kg_* tool that's relevant. Cite memory rows by "
        "id when you use them."
    ),
)

async def main():
    async with agent.run_mcp_servers():
        result = await agent.run(
            "What's the right way to ship a microbots release? "
            "Who do I notify and which tools should I use?"
        )
        print(result.output)

asyncio.run(main())
```

### Claude Desktop config

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "microbots": {
      "transport": "streamable-http",
      "url": "https://app-bf31.onrender.com/mcp/"
    }
  }
}
```

Restart Claude Desktop and you'll see all 13 `kg_*` tools available.

---

## 4. Refreshing / re-ingesting the graph

Two modes, same pipeline (triage → enrich → wiki):

```bash
# Synthetic data — no Composio account / OAuth needed.
PYTHONPATH=knowledge_graph .venv/Scripts/python -m ingest --from-fixtures

# Real Composio data — once users have ACTIVE connections.
PYTHONPATH=knowledge_graph .venv/Scripts/python -m ingest

# Re-run only enrichment + wiki on chats already in DB
# (useful after the LLM credit cap clears).
PYTHONPATH=knowledge_graph .venv/Scripts/python -m scripts.enrich_existing
```

---

## 5. Caveats

| Issue | Severity | Workaround |
|-------|----------|------------|
| Render free tier spins down after ~15 min idle | Low | First request after sleep takes ~30 s. Hit `/health` to wake. |
| No auth on the API itself | Medium | Single-tenant for the hackathon. Don't put real PII in the graph. |
| OAuth credentials live in Composio (not us) | — | Tokens stay server-side at Composio. We never touch raw `xoxb-…` etc. |
| FTS indexes disabled in SurrealDB schema | Low | v3 dropped inline `SEARCH ANALYZER` syntax. Vector (HNSW) and plain indexes still work. |

---

## 6. Files of interest

- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\app\main.py" /> — FastAPI app factory: mounts MCP + registers REST routers
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\app\routes\api_composio.py" /> — the 3 OAuth endpoints
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\app\routes\api_kg.py" /> — REST mirror of MCP tools
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\app\services\composio.py" /> — Composio client wrapper + auth-config discovery
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\app\services\surreal.py" /> — shared SurrealDB session + JSON normaliser
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\app\mcp\tools.py" /> — the 13 MCP tools
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\app\deploy.py" /> — `python app/deploy.py [--status / --teardown]`

---

## 7. Adding a new endpoint

If you need something the existing endpoints don't cover:

1. **REST**: add a handler to `app/routes/api_kg.py` (or a new `api_*.py` module). Re-use `app.services.surreal.q` / `q_one` so REST stays consistent with MCP.
2. **MCP**: add a `@mcp.tool()` in `app/mcp/tools.py`. Mirror the existing pattern (single SELECT with subqueries — multi-statement `LET ... RETURN` doesn't return data over WebSocket in SurrealDB v3).
3. **Composio**: add a method to `app/services/composio.py` and a route in `app/routes/api_composio.py`.
4. Redeploy: `python app/deploy.py` — uses the existing service ID, no new service is created.

---

## Contact

- Anything unclear in this doc → ping the channel.
- The frontend, the agent harness, Claude Desktop, curl — they all point at the same URL. One source of truth.
