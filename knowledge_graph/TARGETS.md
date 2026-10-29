# Entrypoint audit

Audited from the cleanup base without provider keys, with SurrealDB v2 running.
The original suite passed (106 tests, four skips). All original no-key Makefile
targets were executed; `dev`, `db-down`, and `db-reset` are verified during the
end-to-end run/restoration. No `app/` imports KG runtime modules: it uses the KG
schema contract through its own API services. Seed/schema remain startup roots.

| Original target | Disposition | Observed behavior / reason |
| --- | --- | --- |
| `install` | Kept | `uv sync` passes |
| `db-up` | Kept | Passes; Docker Hub rate limit worked around using mirror.gcr.io image |
| `db-down` | Kept | Local DB lifecycle |
| `db-schema` | Fixed | Applies 31 tables; wiki skeleton now preserves existing content, revisions and parent edges on reapply |
| `db-seed` | Kept | Passes; used by `dev` and `db-reset` |
| `dev` | Kept | Schema + seed + API/web; no extraction keys required |
| `db-reset` | Kept | Restore seeded demo after offline verification |
| `ingest` | Fixed | Previously exited 0 with missing keys; now fails clearly, supports `ARGS` |
| `composio-ingest` | Removed alias | Duplicate of `ingest` |
| `composio-auth` | Removed wrapper | Only printed instructions; now in README |
| `ingest-seed` | Removed | Requires LLM key; duplicate `db-seed` + `wiki` sequence |
| `wiki-reset` | Removed | Redundant destructive convenience; reset via `db-reset` |
| `wiki-cat` | Kept | Passes, lists/prints DB wiki pages |
| `wiki` | Fixed | Live needs a key; explicit offline model now supported; counts unchanged pages correctly |
| `test` | Kept | Unit/golden tests pass; no provider requests |
| `e2e` | Kept/extended | Passes; live tests skip; now also tests full offline path and idempotence |
| `synth-corpus` | Kept | Runs deterministically with no keys; synth YAML is covered by passing tests |
| `rerecord-goldens` | Removed | Exited 0 but skipped every case; recording never implemented |
| `eval` | Removed | CLI fails: missing required `--phase`; incomplete live runner and git-mutating promotion wrapper removed |
| `eval-report` | Removed | Only summarized stored scorecards; no live measurements; judge/proposer unused by passing tests |
| `db-query` | Removed | Fails without a TTY; image also lacks `surreal` on PATH; use API or Python DB client |
| `db-export` | Removed | Exit 127: image has `/surreal`, not `surreal` on PATH; not a pipeline stage |
| `surface` | Kept | Passes; deterministic and idempotent candidate surfacing |
| `snapshot` | Removed wrapper | Passes; specialized curation script retained as `python -m candidates.snapshot` |
| `restore-demo` | Removed wrapper | Passes after snapshot; `python -m candidates.snapshot --apply` remains |
| `daemon-cycle` | Removed wrapper | Was `ingest surface`; misleading success without keys; run stages explicitly |
| `scrub` | Removed wrapper | `ARGS=--dry` passes; curation script retained as `python -m candidates.scrub --dry` |
| `ingest-demo` (new) | Added | No-key train fixtures → chats → enrichment → wiki; reruns preserve graph and populated wiki |

Direct module commands need `PYTHONPATH=$PWD:$PWD/knowledge_graph uv run python`.
The unused `scripts/enrich_existing.py` duplicated `run_enrichment` and was removed.
The live eval runner/fixture entrypoint, proposer and judge had no callers among
passing tests; their unverified automation was removed, while tested promotion,
structural and retrieval-QA helpers, rubrics and corpus/golden data remain.
No dependencies were removed: the surviving API and KG paths still use them.
