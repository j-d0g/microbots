# agent/

Jordan's harness planning/build area. Always start task work by consulting `scratchpad/` for active ticket notes and routing.

## Operating rules

- Think before coding. State assumptions when they matter; ask if unclear.
- Before doing task work, read `scratchpad/AGENTS.md`, identify the active ticket, and read that ticket's local README/handoff/spec notes.
- Keep changes small. No extra abstractions, cleanup, or formatting churn.
- Touch only what the task needs. Remove only dead code your change creates.
- Verify before done. Use the narrowest useful test/check.
- Use subagents for isolated research or parallel analysis, not simple reads.
- Keep durable notes inside the active `scratchpad/pN-*` folder.
- Update AGENTS files only for durable rules, not routine progress.

## Coding standards

- Match existing style and dependencies.
- Prefer root-cause fixes over temporary patches.
- Avoid speculative configurability and unnecessary error handling.
- For bugs, reproduce or identify the failing path before fixing.
- For non-trivial changes, make a short plan, implement, then verify.

## Scratchpad notes

- `scratchpad/` is for notes, specs, handoffs, research, and test plans only.
- Do not put implementation code, virtualenvs, generated app scaffolds, `.env` files, or deploy projects in `scratchpad/`.
- When a task needs real code, confirm the implementation location first.
- Current harness implementation code belongs under `harness/` unless Jordan says otherwise.
- Plans/specs: `scratchpad/<pN-ticket>/plan/`.
- Build notes/blockers/results: `scratchpad/<pN-ticket>/notes/`.
- Tests/checks: `scratchpad/<pN-ticket>/tests/`.
