# tests/

Verification scripts and integration tests for each phase of the P1 harness MVP. Populated by the build agent during Phases 0–4.

Expected layout:

```
tests/
├── README.md            ← this file
├── smoke.sh             ← end-to-end smoke test (Phase 0+; refined each phase)
├── phase-0/             ← scaffold gates (health checks, cold-start measurement)
├── phase-1/             ← static loop gates (MCP tool list, consult_docs, search_templates)
├── phase-2/             ← code execution gates (run_code, multi-step chains)
├── phase-3/             ← Composio integration gates (real Slack send)
└── phase-4/             ← demo polish gates (latency budgets, video capture)
```

See `plan/03-handoff.md` for the verification protocol per phase.
