# V1 builder-flow e2e

Deterministic Playwright test for the chat product's V1 builder flow.
Owned by **Agent C** in `agent/scratchpad/p2-v1-tools/plan/01-implementation.md`.

## What it covers

A 5-turn scripted scenario, asserting tool-call sequencing and
result-dict shape (NOT natural-language replies):

1. *"Build me a hello-world that prints the date."* → expect
   `find_examples` and/or `run_code`, then `save_workflow`.
2. *"Show me what I just saved."* → expect `view_workflow`.
3. *"Run it again."* → expect `run_workflow`.
4. *"What have I built?"* → expect `list_workflows` with ≥1 entry.
5. *"What did I work on related to slack?"* → expect `search_memory`
   was called (tolerant of stub vs. wired backend).

## Setup

```sh
cd agent/harness/tests/e2e
npm install
npx playwright install chromium
```

## Running

The default target is a **local stack** because the V1 tools live on
this branch (`jordan/p2-v1-tools`) and the deployed Render frontend
tracks an older branch.

### 1. Start the local MCP server (port 8766)

```sh
cd agent/harness/mcp
PORT=8766 MCP_API_TOKEN=dev-token-local \
  /path/to/.venv/bin/python server.py
```

### 2. Start the local frontend (port 3010)

```sh
cd agent/harness/frontend
# .env.local must contain ANTHROPIC_API_KEY plus:
#   MCP_URL=http://localhost:8766/sse
#   MCP_API_TOKEN=dev-token-local
PORT=3010 npx next dev --port 3010
```

### 3. Run the test

```sh
cd agent/harness/tests/e2e
npm test
```

To target a deployed frontend instead:

```sh
BASE_URL=https://microbot-harness-frontend.onrender.com npm test
```

## Notes

- The chat UI's tool-invocation `<details>` blocks render the result as
  the MCP envelope `{ content: [{type:"text", text:"<json>"}], isError }`.
  The test auto-unwraps to the inner dict.
- `run_code` / `run_workflow` need `RENDER_API_KEY` to actually execute
  Python; without it they return `{result:null, ..., error: "..."}`. The
  test only asserts that the four shape keys are present, so it passes
  either way.
- A clean `agent/harness/mcp/saved/` directory is not required, but
  starting from empty makes the `list_workflows` assertion crisper.
