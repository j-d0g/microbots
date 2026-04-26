# 04 — Changelog & visual progression

A checkpoint-by-checkpoint diary of how the v0 harness took shape, paired
with a Figma board per checkpoint so the architecture at each stage is
visible. Read top-to-bottom for the build narrative; click any board to
see what the harness looked like at that moment.

> **Figma URLs are populated once each board has been generated.**
> Each diagram is a snapshot of the system at that commit — what existed,
> what was a stub, what executed user code.

---

## C0 — Planning & scaffold
**Window:** ~01:11 → 02:39 UTC, 2026-04-26
**Commits:** `bdc445f`, `98097ac`, `b384614`, `38577b0`
**Figma:** https://www.figma.com/board/Ks5Qqry3rYiv4mO5UN8zk9

**What landed**

- Scratchpad reorganised: `p0-braindump-notes/` archived, `p1-harness-mvp/`
  becomes the active ticket with `plan/{01-findings, 02-spec, 03-handoff}.md`.
- Phase-0 MCP server skeleton in `agent/harness/mcp/` — FastMCP, bearer
  auth, exactly one tool (`ping`). 83 lines.
- `render.yaml` Blueprint for the MCP web service. Repo URL added on the
  follow-up commit because the validator required it.

**Architecture state**

A Render Blueprint, an MCP skeleton, and a wall of planning docs.
Nothing executes user code. The agent loop doesn't exist yet.

---

## C1 — Workflows + frontend shell
**Window:** ~03:09 UTC
**Commit:** `704adf5`
**Figma:** https://www.figma.com/board/yFu3jvkxGJJP2rHKHeNBvT

**What landed**

- `agent/harness/workflows/main.py` — first Render Workflows app:
  `noop_task`, `calculate_square`, `sum_squares`, `flip_coin` (the standard
  Render starter shape, plus `noop_task` as a cold-start probe).
- Workflows service deployed to Render (slug `microbots`,
  id `wfl-d7mn9n9f9bms7383cad0`, region oregon, free plan).
- Cold-start verified in `notes/00-render-workflows-cold-start.md`:
  5–6s cold, 3–3.5s warm. Marginal vs the 5s gate but acceptable.
- Frontend skeleton scaffolded: `package.json`, `next.config.js`,
  `app/layout.tsx`, `app/page.tsx`, an empty `/api/chat/route.ts`.
- `notes/01-setup-prereqs.md` documents the env-key + render-cli setup.

**Architecture state**

Workflows live and measurable. Frontend exists but is inert — no chat
loop yet. MCP still skeleton-only. The two halves haven't met.

---

## C2 — Parallelism probes & sponsor angle
**Window:** ~04:02 → 04:51 UTC
**Commits:** `88ff80d`, `f3b52bf`
**Figma:** https://www.figma.com/board/DRwTpMiCGmJFYh4l8YGveM

**What landed**

- `pitch/render.md` — captures the "recursive fan-out" prize angle for
  the Render sponsors. Live demo target: ≥50 parallel containers in 90s.
- `workflows/main.py` extended with `fanout_sum` (parallel via
  `asyncio.gather`), `chain_3` (sequential), and helpers (`trivial_compute`,
  `step1/2/3`). These exist to *measure* whether the scheduler genuinely
  parallelises subtasks vs serialising them — instrumentation, not feature.

**Architecture state**

Workflows now has both feature tasks (the pre-existing `calculate_square`
chain) and instrumentation tasks (`fanout_sum`, `chain_3`). Frontend and
MCP unchanged from C1.

---

## C3 — M0: lean local v0 working
**Window:** ~05:16 → 05:19 UTC
**Commits:** `7f6ac33`, `dbb4ec0`, `f52fc78`
**Figma:** https://www.figma.com/board/D8wPiAs8d3BwSpRAwwQUgS

**What landed**

- The full four-tool chat agent, end-to-end and green. `app/api/chat/route.ts`
  defines `run_code`, `find_examples`, `save_workflow`, `ask_user` *inline*
  using `streamText` + `@ai-sdk/anthropic`. `app/page.tsx` is the chat UI
  with `useChat`, tool-invocation badges, and an inline `AskUserPrompt`
  component for the client-resolved question tool.
- `templates/index.json` seeded with three templates: `hello-world`,
  `fetch-and-count-words` (stdlib `urllib`, not `httpx`), `slack-ping`
  (Composio stub).
- `run_code` in this milestone is a **local subprocess** —
  `spawn("python3", ["-c", code])` with a 30s timeout. Workflows is
  deployed but unused by the chat path.
- Five Playwright specs land (`v0-smoke`, `v1-find-examples`,
  `v1-save-workflow`, `v1-ask-user`, `v1-multistep`); all green in 28.2s.
- Adversarial sub-agent: 5 user scenarios run, 5 pass.
- Model is **Sonnet 4.6** — Opus 4.7 errored with "temperature deprecated"
  in early tests, swapped down for stability. Flip back to Opus is on
  the M1 task list.
- `pitch/agent-loop-diagrams.md`, `pitch/microbots-fractal.md`,
  `pitch/render.md` written for pitch prep.
- Two follow-up commits: align contract on tool name (`ask_user` not
  `Ask_User_A_Question`), fix `fetch-and-count-words` description to say
  `urllib` not `httpx`.

**Architecture state**

The lean-v0 diagram comes alive — but with one shortcut. Tools live
*inline in the FE route handler*, not on the deployed MCP. `run_code`
runs Python locally, not on Workflows. The architecture is the right
*shape* but two halves of the deployed infrastructure (MCP + Workflows)
are still bypassed by the chat path.

---

## C4 — M1 plumbing in flight
**Window:** ~05:42 → 05:43 UTC
**Commits:** `0ca7455`, `70b4b95`
**Figma:** https://www.figma.com/board/cpuy3iQCM119eZu07fubn7

**What landed**

- Scope reframed in `notes/02-v0-v1-contract.md`: v0 becomes **M0 (lean
  local, done)** + **M1 (plumbing, in progress)** + M2 (tuning) + M3
  (swarm). Each milestone has its own done criteria and Playwright gate.
- `workflows/main.py` `run_user_code` implemented for real — exec into a
  namespace, capture stdout/stderr via `redirect_stdout/stderr`, support
  the `main(args)` calling convention, async-aware via `asyncio.run`,
  serialise results best-effort. `httpx`, `requests`, `beautifulsoup4`
  bundled in `requirements.txt` so user code can `import httpx`.
- The MCP server has been updated separately to mirror the four tools
  (`run_code`, `find_examples`, `save_workflow`, `ask_user`), with
  `run_code` delegating to Workflows via `render_sdk`.

**What hasn't landed yet (the M1 finish line)**

- Frontend `/api/chat` is still inline-tools. The wire-up to consume tools
  from the deployed MCP via `experimental_createMCPClient` is the next
  step.
- `find_examples` and `save_workflow` need to move to MCP-server-side
  filesystem (templates and saved workflows live there in the M1 shape).
- Playwright must still pass against the MCP-backed loop with a 60s
  per-test budget for Workflows cold-start.

**Architecture state**

The MCP and Workflows surfaces are now *capable* of being the real
backend. The chat path doesn't yet point at them. The remaining M1 work
is cabling, not new code.

---

## Where we are now

- **M0 done** (lean local v0, inline tools, subprocess Python, tests green).
- **M1 in flight** — Workflows-side execution is real, MCP-side tools
  are real, but `/api/chat` hasn't been switched over yet.
- **M2 / M3 pending** — frontend deploy, end-to-end public URL, and the
  recursive-fan-out demo for the Render prize.

The next move is the M1 cabling: rewire `/api/chat` to use the MCP
client, swap `run_code` from local subprocess to a Workflows trigger,
re-run the Playwright suite with the bumped latency budget. Once that's
green, M2 (frontend deploy) becomes the natural next checkpoint.
