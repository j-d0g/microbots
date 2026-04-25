# Agent Harness Integration Guide

*For Jordan and any other agent author connecting to the microbots knowledge graph.*

The full data pipeline (Composio/synthetic → triage → enrich → wiki) is live and
running against a public SurrealDB. Your agent doesn't talk to SurrealDB directly
— instead, it speaks **MCP (Model Context Protocol)** to a hosted server we've
deployed. That server wraps every named SurrealQL query as a tool. One URL, 13
tools, zero schema knowledge required from your side.

## TL;DR

```
MCP server URL    : https://kg-mcp-2983.onrender.com/mcp
Health probe      : https://kg-mcp-2983.onrender.com/health   (returns 200 OK)
Transport         : streamable HTTP (POST + SSE)
Auth              : none (single-tenant for the hackathon)
Tools             : 13   (kg_user_profile, kg_memories_top, kg_skills_all, …)
Hosting           : Render free tier — spins down after 15 min idle, ~30 s cold start
```

## What's already in the graph (current state)

The pipeline ran on 6 synthetic integration fixtures (Slack, GitHub, Linear,
Gmail, Notion, Perplexity) and produced:

| Table | Rows | Source |
|-------|------|--------|
| `user_profile` | 1 | Seed (Desmond, AI engineer) |
| `integration` | 6 | Triage updated each row's metadata (purpose, patterns, …) |
| `chat` | 49 | LLM triage of 61 raw items (12 dropped as low signal / failed) |
| `entity` | 28 | Entity resolution layer merged mentions across integrations |
| `memory` | 40 | Memory extractor distilled high-signal facts/preferences/decisions |
| `skill` | 19 | Skill detector found atomic repeatable behaviours (strength ≥ 1) |
| `workflow` | 3 | Seeded; workflow composer ran out of LLM credit (free tier cap) |
| `wiki_page` | 18 (10 with content) | Wiki agent populated depth-2/3 pages; depth-1 user.md empty due to credit |

Top memories (highest confidence) include things like:

- *"Alice Chen is the go-to decision-maker for all infrastructure questions."* (0.98)
- *"User always posts a notification to #deployments on Slack before and after every production deploy."* (0.95)
- *"User always creates a Linear ticket before opening a GitHub PR."* (0.92)

## The 13 tools your agent can call

Every tool is read-only (`readOnlyHint=True`, `idempotentHint=True`). All return
JSON-encoded strings.

| Tool | Args | What it returns |
|------|------|-----------------|
| `kg_user_profile` | — | Root user node + aggregate counts (chats, memories, …). Always call first to seed context. |
| `kg_integrations_overview` | — | Every integration with name, slug, frequency, co-usage edges |
| `kg_integration_detail` | `slug, limit=10` | One integration deep-dive: entities + top memories + skills |
| `kg_entity_types` | — | Distinct entity types with counts |
| `kg_entities_by_type` | `entity_type` | All entities of a type with chat-mention counts |
| `kg_entity_detail` | `id` | One entity + which integrations + recent chat mentions |
| `kg_memories_top` | `by="confidence"\|"recency", limit=20` | Highest-priority memories the agent has learned |
| `kg_skills_all` | `min_strength=1` | Atomic repeatable behaviours, with their integrations |
| `kg_workflows_all` | — | Multi-step workflows + ordered skill chain |
| `kg_chats_summary` | — | Chat counts per integration + signal level |
| `kg_wiki_tree` | — | Path + depth for every wiki page (no contents) |
| `kg_wiki_page` | `path` | Read one wiki page's markdown content |
| `kg_health` | — | Sanity check + table count |

The MCP `tools/list` request returns full JSON-Schema input definitions for
each tool so any client (Claude Desktop, Cursor, your harness) auto-renders
them.

## How to consume it from a pydantic-ai agent

```python
import asyncio
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP

# 1. Point at our MCP server
kg = MCPServerStreamableHTTP(url="https://kg-mcp-2983.onrender.com/mcp")

# 2. Build an agent with the kg tools auto-registered
agent = Agent(
    "openrouter:google/gemini-2.5-flash",   # or any model you prefer
    mcp_servers=[kg],
    system_prompt=(
        "You are an assistant for Desmond. Before answering, call "
        "`kg_user_profile` to ground yourself, then `kg_memories_top` "
        "and any other kg_* tool that's relevant. Cite memory rows by "
        "id when you use them."
    ),
)

# 3. Run it
async def main():
    async with agent.run_mcp_servers():
        result = await agent.run(
            "What's the right way to ship a microbots release? "
            "Who do I notify and which tools should I use?"
        )
        print(result.output)

asyncio.run(main())
```

Expected behaviour: the agent calls `kg_user_profile` (sees Desmond's
preferences include `"deploy: always notify #deployments before pushing to prod"`),
then `kg_memories_top` (sees the Alice Chen memory), then `kg_skills_all`
(sees the `deploy_to_staging` and `notify_deployment` skills) — and answers
with concrete tools and a named contact, not a generic LLM hallucination.

## How to consume it from Claude Desktop (no code)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "microbots-kg": {
      "transport": "streamable-http",
      "url": "https://kg-mcp-2983.onrender.com/mcp"
    }
  }
}
```

Restart Claude Desktop and you'll see the 13 `kg_*` tools available in any
conversation. Useful for sanity-checking what's in the graph during development.

## How to consume it from any other client

Plain HTTP. POST a JSON-RPC envelope to `/mcp` with the `Accept: application/json, text/event-stream` header and the standard MCP envelope:

```bash
curl -sS -X POST https://kg-mcp-2983.onrender.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

(In practice, use the `mcp` Python or TypeScript SDK — it handles initialisation,
session ids, and SSE framing for you. See the example above.)

## How to refresh / re-ingest the graph

The pipeline is a CLI you can re-run at any time. Two modes:

```bash
# 1. Synthetic data (no Composio account needed) — what's currently in the DB.
PYTHONPATH=knowledge_graph .venv/Scripts/python -m ingest --from-fixtures

# 2. Real Composio data (requires COMPOSIO_API_KEY + composio link <toolkit>).
PYTHONPATH=knowledge_graph .venv/Scripts/python -m ingest

# 3. Re-run only enrichment + wiki on chats already in the DB
#    (useful after the LLM credit cap clears).
PYTHONPATH=knowledge_graph .venv/Scripts/python -m scripts.enrich_existing
```

Both modes run the **same** triage → enrichment → wiki pipeline. The only
difference is where the raw events come from.

## How to add a new tool to the MCP server

If your agent harness needs a query that's not in the 13 tools above:

1. Add a new SurrealQL string + `@mcp.tool()` function in
   `app/services/kg_mcp/main.py`. Mirror the existing pattern (single
   SELECT with subqueries — multi-statement `LET ... RETURN` doesn't
   return data over WebSocket in SurrealDB v3).
2. Test locally: `PORT=9001 python app/services/kg_mcp/main.py` then
   `python -c "..."` with the MCP client (see existing test scripts).
3. Redeploy: `python app/services/kg_mcp/deploy.py` — uses the existing
   service ID (no new service is created).

## Caveats / known limits

| Issue | Severity | Workaround |
|-------|----------|------------|
| Free Render tier — service sleeps after 15 min idle | Low | First request after sleep takes ~30 s. Subsequent requests are fast. Hit `/health` to wake. |
| No auth on the MCP server | Medium | Single-tenant for the hackathon. Anyone with the URL can read the graph. Don't put PII in there. |
| Workflow composer + 8 wiki pages skipped on this run | Low | OpenRouter free credit hit zero. Re-run `scripts.enrich_existing` after adding $5 of credit (covers ~50 full runs). |
| FTS indexes disabled | Low | SurrealDB v3 changed `DEFINE INDEX … SEARCH ANALYZER` syntax. Vector (HNSW) and plain indexes still work. |

## Files of interest

- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\app\services\kg_mcp\main.py" /> — the MCP server source
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\knowledge_graph\db\queries.py" /> — the canonical named queries (kept in sync by hand with main.py)
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\knowledge_graph\ingest\pullers\fixture.py" /> — synthetic-data puller
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\knowledge_graph\enrich\orchestrator.py" /> — enrichment pipeline (memory → entity → skills → workflow)
- <ref_file file="C:\Users\DaudDewan\OneDrive - SymphonyAI\Documents\Learning\hackathon\microbots\knowledge_graph\scripts\enrich_existing.py" /> — re-run enrichment + wiki against existing chats

## Contact / next steps

- If a tool is missing, file a small issue or DM and I'll add it.
- The frontend will consume the same MCP server (or a thin FastAPI wrapper if it needs CORS / browser-direct access — let me know).
- For real Composio data, run `composio login` + `composio link slack` (etc.) on your machine, set `COMPOSIO_API_KEY` in `.env`, and run `python -m ingest` without `--from-fixtures`. Same pipeline, real OAuth-connected accounts.
