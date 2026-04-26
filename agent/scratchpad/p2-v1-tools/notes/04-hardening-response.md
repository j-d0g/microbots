# 04 — Hardening response

What changed in `agent/harness/mcp/server.py` in response to the
adversarial pass (`notes/02-adversarial-findings.md`).

Three high/medium-severity findings were genuinely this code's
responsibility. The remaining ones are either operational (server not
deployed yet), upstream (`kg_mcp` 404'ing), or system-prompt territory
(hostile prompts bypassing tools).

---

## H3 — silent overwrite on slug collision

**Finding:** `save_workflow` silently overwrote when called twice with
the same name, including the slug-collision case where `"data sync"`
and `"data-sync"` both slugify to `data-sync`. No confirmation, no
error, the previous artifact gone with no trace.

**Fix:** added `overwrite: bool = False` parameter. New default
behaviour:

- File exists, `overwrite=False` (default) →
  `{"error": "exists", "slug": "...", "existing_bytes": <int>, "hint": "..."}`.
- File exists, `overwrite=True` → write proceeds; response includes
  `"overwritten": True`.
- File does not exist → write proceeds as before.

**Why mechanical, not prompt-engineered:** prompts can be circumvented
by adversarial inputs from the user; mechanical enforcement is reliable.
The agent now sees a structured error, can decide whether to ask the
user / pick a different name / opt in to overwrite. The cost is one
extra tool call when the agent legitimately wants to overwrite.

**Test coverage:** `test_save_workflow_hardening.py::TestNoSilentOverwrite`
(4 cases: first save, second save without flag, overwrite=True, slug
collision).

---

## M1 — 1000-char workflow names crashed with `OSError [Errno 63]`

**Finding:** the adversarial probe handed a 1000-character name to
`save_workflow`. Slugify produced a 1000-character slug, the file write
hit the filesystem's `NAME_MAX` (255 on most OSes; macOS APFS varies),
and the tool raised an unhandled `OSError` into the MCP transport.

**Fix:** `_slugify` now caps at `MAX_SLUG_LEN = 64` and strips trailing
`-` after truncation (so we never leave a dangling dash from a mid-word
cut).

```python
MAX_SLUG_LEN = 64

def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    return slug[:MAX_SLUG_LEN].rstrip("-")
```

**Why 64:** filesystem-safe with generous headroom (`NAME_MAX` is 255,
slugs are far below that); long enough to hold descriptive workflow
names; short enough that file listings are scannable. Round number,
not load-bearing.

**Test coverage:** `test_save_workflow_hardening.py::TestSlugLengthCap`
(2 cases: 1000-char name truncates cleanly + round-trips;
unicode/punctuation collapses to ASCII).

---

## M2 — no code-size cap on `save_workflow`

**Finding:** the probe wrote 5 MB of generated source through
`save_workflow` and the call succeeded, persisting it to disk. No
upper bound. A hostile or buggy agent could fill the host's disk.

**Fix:** `save_workflow` now refuses code over `MAX_CODE_BYTES`
(1,000,000 ≈ 1 MB):

```python
MAX_CODE_BYTES = 1_000_000

# inside save_workflow:
code_bytes = len(code.encode("utf-8"))
if code_bytes > MAX_CODE_BYTES:
    return {
        "error": "code too large",
        "bytes": code_bytes,
        "max_bytes": MAX_CODE_BYTES,
    }
```

**Why 1 MB:** workflows are user-friendly Python, not machine-generated
data. A 1 MB Python file is ~30,000 lines — well above any reasonable
workflow. Hitting this cap is a signal of either generation gone wrong
or genuine misuse.

**Test coverage:** `test_save_workflow_hardening.py::TestCodeSizeCap`
(2 cases: under-cap succeeds, over-cap refuses with structured error).

---

## What was deliberately not fixed in this ticket

| Finding | Severity | Why not now |
|---|---|---|
| H1 — V1 server not deployed | high | Parallel infra agent's deliverable; not a code issue. |
| H2 — `search_memory` 404s on `kg_mcp` | high | Code is correct (graceful degradation); upstream service is the issue. Tracked in `plan/01-findings.md` open follow-up #5. |
| L — hostile prompt bypasses tools | low | System-prompt territory, not the harness's job. Flagged for FE / agent-prompt team. |
| Several low-severity error-message leaks | low | Acceptable signal/noise; not exploitable. |

---

## Test count after hardening

41 unit tests passing (33 baseline contract tests + 8 hardening tests).
Run with `.venv/bin/pytest agent/harness/mcp/tests -q` from the worktree
root.
