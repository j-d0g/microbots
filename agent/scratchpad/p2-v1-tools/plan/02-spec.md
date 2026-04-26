# 02 — Spec

Tool contracts for the V1 surface. Implementation lives in
`agent/harness/mcp/server.py`. This doc is the source of truth for what
the agent and any consumer should expect.

---

## At a glance

V0 (carried forward unchanged):
- `run_code(code, args=None)` — execute Python in the Workflows runner
- `find_examples(query)` — substring search of `templates/index.json`
- `save_workflow(name, code, overwrite=False)` — persist; **see D4**
- `ask_user(question, options=None)` — client-resolved deferral

V1 additions:
- `view_workflow(name)` — read source by name
- `run_workflow(name, args=None)` — invoke saved workflow
- `list_workflows()` — enumerate saved workflows
- `search_memory(query, scope="all")` — proxy to `kg_mcp`

All tools return JSON-serialisable dicts. No tool ever raises into the
MCP transport; all error paths return a dict with an `error` key.

---

## Hardening caps

Defined in `server.py` as module-level constants:

```python
MAX_SLUG_LEN   = 64        # filesystem-safe; well under NAME_MAX (255)
MAX_CODE_BYTES = 1_000_000 # ~1 MB hard ceiling on saved workflow source
```

Both are enforced inside tool bodies. See `notes/04-hardening-response.md`
for the adversarial findings that motivated them.

---

## V1 tool contracts

### `view_workflow(name: str) -> dict`

Reads back the source of a previously saved workflow.

**Success shape:**
```python
{
  "name":  "<input name, untouched>",
  "slug":  "<slugified, capped at MAX_SLUG_LEN>",
  "code":  "<file contents, utf-8>",
  "bytes": <int, len(code.encode("utf-8"))>,
}
```

**Failure shapes:**
- `{"error": "invalid name (must produce a non-empty slug)"}`
  — name slugified to empty (e.g. `"!!!"`).
- `{"error": "workflow not found: <slug>"}`
  — file does not exist on disk.

**Invariants:**
- Round-trips with `save_workflow`: `view(save(name, code).slug).code == code`.
- Pure read; never writes.

---

### `run_workflow(name: str, args: dict | None = None) -> dict`

Loads `saved/<slug>.py` and executes it via the same Workflows runner
that backs `run_code`. Distinct from `run_code`: this hits the saved
artifact, not an ad-hoc snippet.

**Success / runtime-error shape (same as `run_code`):**
```python
{
  "result": <any | None>,
  "stdout": "<str>",
  "stderr": "<str>",
  "error":  "<str>",   # empty string on success
}
```

**Pre-dispatch failure shapes:**
- `{"result": None, "stdout": "", "stderr": "", "error": "invalid name"}`
- `{"result": None, "stdout": "", "stderr": "", "error": "workflow not found: <slug>"}`

**Invariants:**
- The shape of a pre-dispatch failure matches a runtime failure exactly,
  so callers can branch on `error` without having to handle two
  envelopes.

---

### `list_workflows() -> dict`

Enumerates saved workflows. Sorted by most-recently-modified first.

**Shape:**
```python
{
  "workflows": [
    {
      "slug":     "<filename without .py>",
      "summary":  "<first line of docstring, or first non-import line, ≤120 chars>",
      "bytes":    <file size>,
      "modified": <unix timestamp, float>,
    },
    ...
  ],
  "count": <int>,
}
```

**Invariants:**
- Empty `saved/` dir returns `{"workflows": [], "count": 0}` (never an
  error).
- `count == len(workflows)`.
- `summary` is best-effort: tries module docstring first, falls back to
  first non-blank, non-import, non-comment line. Never empty string only
  unless source was empty.

---

### `search_memory(query: str, scope: str = "all") -> dict`

Searches the user's memory. Wired to `kg_mcp` for `scope ∈ {"kg", "all"}`;
`scope == "recent_chats"` is an honest empty-results stub until the
chat-summary pipeline lands.

**Shape (always):**
```python
{
  "results": [
    {"source": "<str>", "scope": "<str>", "snippet": "<str>", "score": <float>},
    ...
  ],
  "query": "<echoes input>",
  "scope": "<echoes input, defaulting to 'all'>",
  # Optional fields:
  "stub":  <bool>,       # present when this scope is stubbed
  "error": "<str>",      # present on backend failure
}
```

**Behavioural rules:**
- Async (may issue HTTP). Callers must `await`.
- Never raises into the MCP transport. Backend timeouts / 4xx / 5xx all
  return `{"results": [], "error": "kg_mcp unreachable: <detail>", ...}`.
- Empty query is valid; backend may return its top-N memories.
- Result list may be empty; that's not an error condition.

**Environment:**
- `KG_MCP_URL` (default: the deployed kg_mcp endpoint)
- `KG_MCP_API_TOKEN` (read but unused; kg_mcp has no auth today)

---

## V0 tool contracts (carried forward, with V1 changes flagged)

### `save_workflow(name: str, code: str, overwrite: bool = False) -> dict`

**V1 change:** `overwrite` parameter added (default `False`). See D4 in
`plan/01-findings.md`.

**Success shape:**
```python
{
  "url":         "https://example.com/workflows/<slug>",
  "saved_to":    "<absolute path>",
  "bytes":       <int>,
  "overwritten": <bool>,
}
```

**Failure shapes:**
- `{"error": "invalid name (must produce a non-empty slug)"}`
- `{"error": "code too large", "bytes": <int>, "max_bytes": MAX_CODE_BYTES}`
- `{"error": "exists", "slug": "<str>", "existing_bytes": <int>, "hint": "<str>"}`
  — file already exists and `overwrite=False`. Caller should rename, ask
  the user, or retry with `overwrite=True`.

### `run_code`, `find_examples`, `ask_user`

Unchanged from V0. See top-of-file docstring in `server.py` for full
contracts.

---

## Helpers (private, but contracted)

### `_slugify(name: str) -> str`

Lowercase, replace non-`[a-z0-9-]` runs with `-`, strip leading/trailing
dashes, **truncate to `MAX_SLUG_LEN` characters**, then re-strip
trailing dashes (so a truncation never leaves a dangling `-`).

Returns `""` if the input has no slug-safe characters; callers must
treat empty as an error.

### `_first_summary(text: str) -> str`

Returns the first line of the module docstring (`"""..."""`) if present;
otherwise the first non-blank, non-`import`, non-`from`, non-`#` line,
truncated to 120 chars. Returns `""` for empty / all-blank source.

---

## Compatibility notes

- The `save_workflow` signature change is **additive** with a default —
  V0 callers passing `(name, code)` continue to work as long as they
  don't hit a slug collision. On collision they now see
  `{"error": "exists", ...}` instead of silent overwrite, which is the
  intended behaviour change.
- All other V0 tools are untouched.
- Unit tests assert *contract shape* (key presence, types) rather than
  exact data, so they remain valid through future backend swaps for
  `search_memory` and through any cosmetic changes to summaries / URLs.
