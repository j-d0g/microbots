# p2-v1-tools — V1 Essential Tools

**Branch:** `jordan/p2-v1-tools`, branched from `jordan/microbot_harness_v0`.
PRs back to the harness branch, not main.

## Goal

Lift the harness from a "demo tour" (V0: build → save → done) to a real
builder loop that supports iteration, recall, and memory grounding. Add
four tools, ending at eight total.

## Design principles (Thariq / Anthropic harness engineering)

- Few composable tools beat many narrow ones. Each new tool earns its
  place by enabling a *new conversation type*, not just a new verb.
- Tools should do things the model can't do itself. Side effects in the
  world, not knowledge retrieval.
- The harness is cache-shaped — keep tools stable; never swap mid-session.
- Memory lives on the filesystem, not in longer prompts.

## V1 additions

1. **`view_workflow(name)`** — read back a saved workflow's source.
   Mirror of `save_workflow`. Without it the agent is permanently
   amnesiac about its own past output.
2. **`run_workflow(name, args)`** — invoke a saved workflow. Loads from
   `saved/<slug>.py` and runs through the same Render Workflows path as
   `run_code`. The demo's actual punchline: build, save, *run as a user*.
3. **`list_workflows()`** — surface what the user has built. Enables
   "what have I made?" / "show me my data ones" conversations.
4. **`search_memory(query, scope)`** — V1-stubbed shape for the
   differentiator. Scopes: `kg`, `recent_chats`, `all`. KG hits the
   existing `knowledge_graph/` ingestion (Slack, Notion, Gmail, Linear,
   GitHub); `recent_chats` hits rolling session-digest summaries.
   Backend wiring is the next ticket.

## Explicitly out of scope for V1

- `validate_workflow` — `run_code` covers it.
- `inspect_workflow_logs` / `cancel_workflow` — debugging is V2.
- Versioning (`list_implementations`, `set_active_implementation`).
- `Set_Behavior_Mode`, `todo_write` — Opus 4.7 doesn't need them; per
  Thariq, scaffolding for weaker models can constrain stronger ones.
- Skills scaffolding — separate ticket; not a tool change.
- `ask_user` description rewrite (delegate-before-asking, bundle
  implications) — separate ticket; prompt engineering, not a code change.

## Files touched

- `agent/harness/mcp/server.py` — added 4 `@mcp.tool` functions and two
  shared helpers (`_slugify`, `_first_summary`). Extracted slugify out
  of `save_workflow` so the new tools share the canonical implementation.
- Top-of-file docstring updated to list 8 tools.

## Verification

- `python3 -c "import ast; ast.parse(open(...).read())"` — syntax clean.
- 8 `@mcp.tool` decorators present.
- Existing V0 tools untouched in behaviour (only `save_workflow`'s
  inline regex was extracted to `_slugify`).

## Open follow-ups

1. Wire `search_memory` to the real KG (the `kg_mcp` deployment on agemo
   `main` looks like the natural target).
2. Build the rolling chat-summary pipeline that feeds
   `search_memory(scope="recent_chats")`.
3. Rewrite `ask_user`'s description to encode the
   delegate-before-asking / bundle-implications discipline.
4. Land the skills scaffolding (folders with description-as-trigger) so
   the runtime contract and per-integration knowledge live there
   instead of drifting into the system prompt.
