# 00 — V0 baseline

What the harness looked like at the start of V1 work, so this folder
makes sense in isolation later.

---

## V0 tool surface (4 tools)

Live as of `jordan/microbot_harness_v0` HEAD `37e15df` ("notes: tool
schemas + UI states for designer/frontend handoff"). Defined in
`agent/harness/mcp/server.py`:

| Tool | Backed by |
|---|---|
| `run_code(code, args)` | Render Workflows `microbots/run_user_code` task |
| `find_examples(query)` | substring score over `templates/index.json` |
| `save_workflow(name, code)` | write to `saved/<slug>.py`, return mock URL |
| `ask_user(question, options)` | client-resolved on the FE; server returns a placeholder |

Server is FastMCP with bearer auth (`MCP_API_TOKEN`), SSE transport
(Vercel AI SDK MCP client compatibility), `/health` endpoint bypassed
from auth.

`render.yaml` blueprint at the repo root deploys the MCP service as a
Render Web Service.

---

## What V0 demos well

A "tour" conversation:

1. User: "Hey, can you show me what you can do? Call some tools, run
   some scripts, and turn it into a workflow."
2. Agent calls `find_examples("demo workflow")`, picks a hello-world
   template.
3. Agent calls `run_code(...)` once or twice to demonstrate execution.
4. Agent calls `save_workflow("demo workflow", code)`, returns
   `{url: "https://example.com/workflows/demo-workflow", saved_to: ..., bytes: 779}`.
5. Agent narrates what it just did with emoji + tables.

That's the V0 demo. It works. It also doesn't go anywhere.

## What V0 cannot do (the conversations V1 unlocks)

| Conversation type | V0 verdict |
|---|---|
| "Change my demo workflow to also send an email." | Impossible — no read primitive. |
| "Run the data-pipeline I saved yesterday." | Possible only if the agent can read the file via `run_code`'s sandbox `os.listdir` — wrong filesystem, fragile. |
| "What have I built?" | Same — the agent has to fish in the wrong filesystem. |
| "What did I work on related to slack?" | Impossible — no memory access. |

These four conversations, and everything that composes from them, are
the entire reason V1 exists.

---

## Architectural scaffolding already in place

Worth noting because V1 inherits these and shouldn't reinvent them:

- **Render Workflows runner** — pre-deployed scratch-task that V1's
  `run_workflow` reuses. No new deploy needed.
- **`templates/index.json`** — the substring-searched catalogue
  `find_examples` reads. V1 doesn't expand the catalogue but doesn't
  conflict with it either.
- **`saved/` directory** — local on the MCP server's filesystem.
  V1's `view_workflow` / `run_workflow` / `list_workflows` all read
  from here.
- **Bearer auth + SSE transport** — unchanged in V1.

What V1 *adds* on top: four tool functions in the same file, two helper
functions (slugify + first-line summary), two hardening caps. ~200
lines of new server code total.
