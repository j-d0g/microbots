# notes/

Running notes captured during the V1 build. Append-only working memory.

When something here crystallises into a decision, it moves into `plan/`
(per the same convention as `p1-harness-mvp/notes/`).

## Index

- `00-v0-baseline.md` — what the harness looked like before V1; the
  "demo tour" pattern this ticket lifts beyond.
- `02-adversarial-findings.md` — Agent B's stress-test report. 47 tests,
  14 issues, 3 high / 6 medium / 5 low.
- `03-kg-mcp-recon.md` — Agent D's recon and wire of `search_memory`
  against the existing `kg_mcp` deployment.
- `04-hardening-response.md` — what changed in `server.py` in response
  to the adversarial pass.
- `05-test-coverage.md` — inventory of unit + e2e tests, where they
  live, how to run them.
- `06-progress-log.md` — chronological record of the V1 build.

(`01-` is intentionally unused — this folder started its numbering at
`02-` because the adversarial findings landed first; the gap is
preserved so file numbers reflect order of arrival.)

## Conventions

- One topic per file. Don't merge unrelated content.
- Numbered prefixes reflect arrival order, not priority.
- "Findings", "decisions", "trade-offs" go into `plan/` once
  crystallised.
- Adversarial reports name severity explicitly: `low | medium | high`.
