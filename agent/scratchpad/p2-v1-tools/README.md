# p2-v1-tools — V1 Essential Tools

**Branch:** `jordan/p2-v1-tools`, branched from `jordan/microbot_harness_v0`.
PRs back to the harness branch, not `main`.

**Status as of 2026-04-26:** four tools shipped, 41 unit tests passing,
Playwright e2e green, adversarial findings captured and the high-severity
ones already fixed. Worktree is committed and ready to merge.

## Goal

Lift the harness from a "demo tour" (V0: build → save → done) to a real
builder loop that supports iteration, recall, and memory grounding.
**Eight tools total** — V0's four plus four V1 additions.

## V1 additions in one line each

- `view_workflow(name)` — read back a saved workflow's source.
- `run_workflow(name, args)` — invoke a saved workflow by name.
- `list_workflows()` — surface what the user has built.
- `search_memory(query, scope)` — proxy to `kg_mcp`'s memories tool;
  `recent_chats` scope is honestly stubbed pending a chat-summary pipeline.

## Document map

| File | Purpose |
|---|---|
| `plan/01-findings.md` | Why these four tools, principles applied, decisions (D1–Dn), open trade-offs |
| `plan/02-spec.md` | Tool contracts: signatures, return shapes, invariants, failure modes |
| `plan/03-handoff.md` | Done / pending / how we got here / next ticket |
| `notes/README.md` | Index for the running notes |
| `notes/00-v0-baseline.md` | What V0 looked like before this work began |
| `notes/02-adversarial-findings.md` | Agent B's stress-test report (14 issues) |
| `notes/03-kg-mcp-recon.md` | Agent D's recon + wire of `search_memory` |
| `notes/04-hardening-response.md` | What changed in response to the adversarial pass |
| `notes/05-test-coverage.md` | Inventory of unit + e2e tests, how to run them |
| `notes/06-progress-log.md` | Chronological record of the V1 build |
| `tests/README.md` | Pointer to where the test code actually lives |

## Convention

Per `agent/scratchpad/AGENTS.md`: tickets are `pN-short-name/`, branches
are `jordan/pN-short-name`. Notes folders are append-only working memory;
when something crystallises into a decision, it moves to `plan/`.
