# 06 — Progress log

Chronological record of how the V1 build proceeded. Reading top-to-
bottom should reconstruct the sequence of decisions and discoveries.

---

## Phase 1 — Brainstorm and target the eight-tool surface

Starting from the V0 chat transcript (a "demo tour" of `find_examples` →
`run_code` → `save_workflow`), the question was: what additions turn
this into a real builder loop?

Applied harness-engineering principles (few composable tools, tools do
what the model can't, harness is cache-shaped) and landed on four
additions:

1. `view_workflow` — read-back partner of `save_workflow`. Without it,
   iterate-on-existing is impossible.
2. `run_workflow` — invoke the saved artifact, distinct from `run_code`.
3. `list_workflows` — surface what the user has built.
4. `search_memory` — proxy to memory backends; the user-specific
   differentiator.

Explicitly rejected: `validate_workflow`, monitoring tools,
versioning, `Set_Behavior_Mode`, `todo_write`. Each rejection is
documented in `plan/01-findings.md`.

## Phase 2 — Worktree + initial implementation

Created `jordan/p2-v1-tools` branch off `jordan/microbot_harness_v0` at
`microbots/agent/.worktrees/jordan-p2-v1-tools`. Adds merge back into
the harness branch, not `main`.

Wrote the four tools into `agent/harness/mcp/server.py` plus two
helpers (`_slugify` extracted from `save_workflow`'s inline regex,
`_first_summary` for `list_workflows`). Top-of-file docstring updated
from "4 tools" to "8 tools." `search_memory` initially shipped as a
stub returning empty results.

Syntax check: clean. Eight `@mcp.tool` decorators registered.

## Phase 3 — Verification dispatch

Four sub-agents launched in parallel with clean file-ownership:

- **A — unit tests** wrote `agent/harness/mcp/tests/` with 33 contract-
  shape tests. Mocked Render Workflows two ways (monkeypatch
  `run_code`, plus a `_FakeRender` injected via `_render_client`).
  All 33 passed in 0.40s.

- **B — adversarial QA** drove the chat product through Chrome
  DevTools / Playwright as a hostile user. 47 stress tests, 14
  findings: 3 high (V1 not deployed, `search_memory` 404'ing on
  upstream `kg_mcp`, silent overwrite on slug collision), 6 medium
  (1000-char OSError, no code-size cap, slug-rewrite leakage, etc.),
  5 low. Report at `notes/02-adversarial-findings.md`.

- **C — Playwright e2e** wrote a deterministic build → save → view →
  run → list → search test against a local V1 stack. 5 turns, 1
  passing test, ~1.1m. Test file at
  `agent/harness/tests/e2e/playwright/v1-flow.spec.ts`. Phrasing-
  tolerant assertions (tool-call sequence + dict shape, not text
  content).

- **D — `kg_mcp` recon + wire** found that `kg_mcp` lives in this repo
  and exposes 13 tools, none of which are free-text search. Closest
  match: `kg_memories_top`. Wired `search_memory(scope="kg" | "all")`
  as a thin streamable-HTTP MCP proxy with client-side substring
  filter — ~50 LOC, no auth complications, graceful degradation on
  upstream errors. `recent_chats` left as honest stub. Recon at
  `notes/03-kg-mcp-recon.md`.

## Phase 4 — Synthesis: hardening + test fixes

Agent D's `search_memory` rewrite changed the function signature from
sync to async (it now `await`s the streamable HTTP call), which broke
six of Agent A's `search_memory` contract tests (they were calling it
as sync and getting a coroutine back). Fixed: rewrote
`test_search_memory.py` as `async def` tests; the project's
`asyncio_mode = "auto"` handles the rest.

Three of Agent B's findings were genuinely this code's responsibility
and worth fixing in this ticket:

- **H3 (silent overwrite):** added `overwrite: bool = False` to
  `save_workflow`. Default refuses with `{error: "exists"}`. See
  `plan/01-findings.md` D4.
- **M1 (1000-char OSError):** capped `_slugify` at `MAX_SLUG_LEN = 64`.
- **M2 (no code-size cap):** capped `save_workflow` at
  `MAX_CODE_BYTES = 1_000_000`.

Updated existing test that relied on V0's overwrite-by-default
behaviour to pass `overwrite=True` explicitly. Added 8 new hardening
tests in `test_save_workflow_hardening.py`.

Final test count: 41 passing in 2.7s.

## Phase 5 — Commit + documentation

Single squashed commit `b94d6f5`: 19 files, 1803 insertions, 7
deletions. Covers code + tests + notes/recon docs.

This documentation pass (the `plan/` and `notes/` files) followed
afterwards to bring the folder into line with `p1-harness-mvp/`'s
shape — same convention, comparable substance, suitable for the next
agent or human to pick up cold.

---

## Surprises worth noting

- **The V0 implementation was further along than expected.** Started
  the session thinking V0 was an 83-line skeleton with one `ping`
  tool; it was actually a complete four-tool implementation wired to
  Render Workflows with bearer auth + SSE transport. A lot of V1's
  work was additive rather than scaffolding.
- **`kg_mcp` was reachable from this repo.** Initial assumption was
  that wiring `search_memory` would require cross-repo work into a
  parent monorepo. It didn't — `kg_mcp` lives in this repo's `main`
  with a Render deployment. Wiring went from "multi-day project" to
  "~50 LOC tool body."
- **`kg_mcp`'s deployed endpoint 404s on `/health` and `/mcp`.**
  Could be cold-start, decommissioned, or URL rotation. The V1 wire
  handles this gracefully (returns empty results + `error` field), but
  the demo wants the service warm. Tracked as an open follow-up.
- **Agent D's async signature change broke Agent A's tests.** Hidden
  coupling — Agent A wrote sync-style tests against a sync stub; Agent
  D made the tool async. Caught quickly because the tests ran. A
  reminder that "clean file ownership" between parallel agents
  doesn't fully isolate them when they share a contract.
