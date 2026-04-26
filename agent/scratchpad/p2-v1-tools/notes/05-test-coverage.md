# 05 — Test coverage

What tests exist for the V1 surface, where they live, what they assert,
and how to run them.

---

## Inventory

### Unit tests — `agent/harness/mcp/tests/`

41 pytest tests, run in 2.7s, all green. Mocks Render Workflows so no
network calls.

| File | Tests | What it covers |
|---|---|---|
| `conftest.py` | — | Shared `server` fixture: monkeypatches `SAVED_DIR` to a per-test `tmp_path`, sets harmless env vars, reloads the module each test |
| `test_helpers.py` | 11 | `_slugify` round-trips, edge cases, length cap; `_first_summary` docstring vs fallback behaviour |
| `test_view_workflow.py` | 5 | Round-trip with `save_workflow`, missing file, invalid name, empty name, post-overwrite read |
| `test_run_workflow.py` | 5 | Missing-name error, invalid-slug error, dispatch to `run_code`, no-args path, full path with fake Render client |
| `test_list_workflows.py` | 6 | Empty dir, count, required keys, docstring summary, fallback summary, mtime ordering |
| `test_search_memory.py` | 6 | Contract-shape (default scope, explicit scope reflected, results-is-list, optional fields), empty-query tolerance, stub-flag is bool |
| `test_save_workflow_hardening.py` | 8 | Overwrite gate (4 cases), slug length cap (2), code size cap (2) |

**Design rule applied to all tests:** assert *contract shape* (key
presence, types) not specific data. `search_memory` may be stubbed
today, wired to `kg_mcp` tomorrow, or backed by something else next
week — the tests stay valid.

### E2E test — `agent/harness/tests/e2e/`

One Playwright test, 5 turns, ~1.1m runtime, currently runs against a
local stack (V1 MCP + V1 FE both started fresh from this branch).

| File | Purpose |
|---|---|
| `playwright/v1-flow.spec.ts` | Build → save → view → run → list → search_memory; asserts tool-call sequencing + dict-shape |
| `playwright.config.ts` | Test runner config |
| `package.json` + `package-lock.json` | Dependencies |
| `README.md` | How to run |

**Phrasing-tolerant:** assertions are on which tools fired and what
fields are present in the tool results, not on the agent's natural-
language response text. Survives prompt revisions.

**Pointing at production:** the deployed Render frontend currently
tracks `jordan/microbot_harness_v0`, so V1 tools don't exist there
yet. Once the parallel infra work ships V1 to production, run the test
against the deployed URL via `BASE_URL=https://...` env var.

---

## Running the tests

From the worktree root (`agent/.worktrees/jordan-p2-v1-tools`):

```sh
# Unit tests (fast, no network)
.venv/bin/pytest agent/harness/mcp/tests -q

# Unit tests with verbose output
.venv/bin/pytest agent/harness/mcp/tests -v

# Single file
.venv/bin/pytest agent/harness/mcp/tests/test_view_workflow.py -v

# E2E (requires local MCP + FE running, OR BASE_URL pointing at deployed)
cd agent/harness/tests/e2e
npm install        # first run only
npx playwright test
```

The worktree has a Python `.venv` already populated with `pytest`,
`pytest-asyncio`, and the harness's runtime dependencies.

---

## What's not yet covered

- **Integration tests against a real `kg_mcp`.** The unit tests mock
  the streamablehttp_client; the e2e test asserts shape only. A real
  integration test would need `kg_mcp` warm and reachable, which is
  flaky right now. Defer until the upstream service is reliably up.
- **Load / concurrency.** Single-user happy-path coverage; no
  contention or parallel-request tests. Acceptable for V1 demo scope.
- **FE-resolved tool flows (`ask_user`).** The e2e test invokes the
  agent through the full chat surface but doesn't exercise the
  `ask_user` resolution path because the V1 conversation didn't
  require user confirmation. Worth a dedicated test in p3 once the
  `ask_user` description rewrite lands.
- **Adversarial regressions.** The 14 findings in `02-adversarial-
  findings.md` are documented but only the 3 high-severity ones have
  unit-test coverage (in `test_save_workflow_hardening.py`). The
  medium/low ones are acceptable risk for V1.
