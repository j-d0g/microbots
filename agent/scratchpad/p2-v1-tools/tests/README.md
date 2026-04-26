# tests/

Pointer file. Unlike `p1-harness-mvp/tests/`, the V1 test code lives
adjacent to the source it covers, not inside `scratchpad/`. The
canonical paths:

| Suite | Path | Files | Runtime |
|---|---|---|---|
| Unit (pytest) | `agent/harness/mcp/tests/` | 8 | ~3s |
| E2E (Playwright) | `agent/harness/tests/e2e/` | 4 | ~1.1m |

See `notes/05-test-coverage.md` for the full inventory, what each test
asserts, and how to run them.

## Why tests live alongside source rather than under scratchpad

- The pytest suite imports `server.py` directly — co-locating tests
  with source matches Python conventions and avoids `sys.path`
  gymnastics.
- The Playwright suite has its own `package.json` + `node_modules`
  footprint; placing it under `agent/harness/tests/e2e/` keeps
  scratchpad lean and avoids committing JS lock files into a notes
  folder.

`p1-harness-mvp` made the opposite choice (Playwright tests inside
scratchpad). Both work; V1 picked co-location for the reasons above.
The choice is documented here rather than litigated.
