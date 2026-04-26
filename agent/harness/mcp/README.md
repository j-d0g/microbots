# mcp/

Phase-0 MCP server skeleton. FastMCP + bearer auth + a single `ping` tool.

Used to verify the harness loop (browser → MCP → tool call → response) end-to-end before adding the real P1 tool surface.

## Tools (Phase 0)

| Tool | Purpose |
|---|---|
| `ping` | Liveness probe. Returns `{status, server_time}`. |

The full P1 tool surface (`consult_docs`, `search_templates`, `run_code`, `Ask_User_A_Question`, `Set_Behavior_Mode`) is added in Phases 1–4 — see `agent/scratchpad/p1-harness-mvp/plan/02-spec.md`.

## Local development

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Run without auth (dev only)
.venv/bin/python server.py

# Or run with bearer auth
MCP_API_TOKEN=dev-token .venv/bin/python server.py
```

Server listens on `PORT` (default `10000`).

### Verify

```bash
curl -sf http://localhost:10000/health
# -> {"status":"ok"}

# Initialize an MCP session and list tools (with auth)
curl -s -X POST http://localhost:10000/mcp \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## Deploy

Follow the Render `mcp-server-python` Blueprint pattern: a `web` service with `python server.py` start command, `MCP_API_TOKEN: { generateValue: true }`, and `healthCheckPath: /health`.
