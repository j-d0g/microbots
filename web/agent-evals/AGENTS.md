# microbots UI agent — improvement plan

This is the **living** plan Devin Cloud reads at the start of each session.
Update the sprint log at the bottom every PR.

The goal: take the microbots UI agent from "responds to clear UI
commands" to "performatively stages the canvas in response to anything
Maya says" — including queries only marginally related to the UI. The
agent should naturally chain `open → arrange → scroll → select →
highlight` style interactions and feel snappy and intentional.

**The single sharpest weakness today** is intent inference under
low-signal-to-noise input. The agent already does well when the user
spells out exactly what they want. Where it falls down is when the
user is waffling — feelings, vague status checks, half-formed
thoughts, conversational asides. **Every sprint must explicitly weight
the `marginal` corpus subset** when picking what to ship next. The
agent must extract real intent from waffle and stage the canvas
anyway.

Note: the existing implementation is already quite good. Sprints
should be **tight, polish-oriented, and eval-gated** — not full
rewrites. Stop early if metrics plateau.

Strategy is locked:

- **Production model (UI agent)**: `google/gemini-2.5-flash-lite` via
  OpenRouter. Locked for cost control. Do not bake off; do not switch.
  All wins come from prompts, context engineering, architecture, and
  tool surface. The `OPENROUTER_API_KEY` powers ONLY the live UI agent
  (orchestrator + layout-agent + content-agent).
- **Eval corpus generation & LLM-judge**: Devin's own assistant model
  (Claude / whichever Devin Cloud is running). Devin writes the seed
  corpus in `corpus/queries.yaml` directly during Sprint 0 — no
  OpenRouter calls for generation. The LLM-judge scoring also runs on
  Devin's model via the standard agent loop, NOT via OpenRouter. This
  keeps OpenRouter spend bounded to actual UI agent runs.
- **Cadence**: capability sprints — one named capability per Devin
  session, one PR with measurable deltas. Sprints should be short.
- **Tools-first**: prefer adding/registering tools and richer snapshot
  state over new UI. New UI is allowed only with a written
  justification, MUJI rigor (existing tokens only), and rigorous tests.

---

## North-star criteria

Every PR must report these six metrics. The eval harness in this
folder produces them deterministically.

| Axis | Metric | Scoring | Target |
|---|---|---|---|
| **Tool-call correctness** | golden-corpus pass-rate | rules (`must_include_tools` / `must_not_include_tools` / `expected_windows_after`) | ≥ 90% |
| **Latency** | TTFW (time-to-first-`ui.*`-event) p50; full-turn p50 / p95 | timer | TTFW < 600ms · p50 < 1.8s · p95 < 3.2s |
| **Multi-step performativity** | mean tool calls per turn on the *performative* corpus subset | counted | ≥ 4.0 |
| **Coverage / generality** | pass-rate on *marginal-intent* subset (the headline metric) | rules + Devin's judgement on the transcript | ≥ 70% |
| **Recovery** | fraction of failed tool calls followed by a successful retry | counted from `agent.tool.retry` events | ≥ 60% |
| **Calm canvas** | post-turn windows match relevance, no stray opens | Devin's judgement on the transcript | ≥ 4 / 5 |

5 of 6 metrics are purely deterministic (rules + timers + counters)
and require no LLM at eval time — the runner produces them with no
API beyond the actual UI-agent run. The two judgement axes (coverage
nuance + calm-canvas) are scored by Devin reading the committed
transcripts during the sprint, with scores written into the report
alongside a one-line rationale per query. This means the eval costs
**only the OpenRouter calls to flash-lite for the actual UI-agent
runs** — nothing else.

A PR that regresses any metric without written justification cannot
merge. **`marginal-intent` pass-rate is the headline.** Other metrics
matter, but if the agent is still bad at extracting intent from
waffle, the sprint hasn't moved the needle.

---

## Layout of this folder (built in Sprint 0)

```
web/agent-evals/
  AGENTS.md                  ← this file
  corpus/
    queries.yaml             ← 80 versioned queries, marginal-weighted (see below)
    expected.yaml            ← per-query rules: must_include_tools, must_not_include_tools, expected_windows_after, judge_tags
  instrument.ts              ← wraps runOrchestrator: per-step timing, retry tracking
  run.ts                     ← runs corpus in-process, writes a transcript-rich report
  judge.md                   ← rubric Devin uses when scoring the two judgement axes by hand
  reports/
    YYYYMMDD-<sprint>-<sha>.json   ← deterministic metrics + transcripts + judge scores
    screenshots/                    ← Playwright captures from snapshot-rooms.mjs
  scripts/
    snapshot-rooms.mjs       ← Playwright capture of post-turn canvas state
```

No `judge.ts`. The judgement axes are scored by Devin Cloud reading
the transcripts during the sprint, then committing scores into the
JSON report. This is intentional — it keeps the eval free of any
non-OpenRouter LLM dependency and makes the scoring auditable.

Wired into `web/package.json` as:

```
"agent:eval": "tsx agent-evals/run.ts",
"agent:eval:quick": "tsx agent-evals/run.ts --quick"
```

---

## Files Devin will touch most often

| File | Purpose |
|---|---|
| `web/lib/agent/orchestrator.ts` | top-level system prompt; `delegate_*` tools |
| `web/lib/agent/layout-agent.ts` | spatial reasoning prompt + `stepCountIs` |
| `web/lib/agent/content-agent.ts` | content sub-agent prompt + per-window dispatch |
| `web/lib/agent/snapshot.ts` | `WindowSnapshot` shape; what the agent sees |
| `web/lib/agent/server-snapshot.ts` | server-side simulator + `snapshotToPrompt` |
| `web/lib/agent/tools.ts` | layout + content tool surface (Zod) |
| `web/lib/agent/window-tools.ts` | per-room tool surface + intent-keyed disclosure |
| `web/components/rooms/*Room.tsx` | per-room `registerTools(...)` calls |
| `web/components/stage/window-registry.ts` | per-kind summary + view-state hook |
| `web/lib/agent-client.ts` | SSE event types; client-side dispatch |

Files Devin will **delete** (in Sprint 0 cleanup):

- `web/app/api/agent/stream/route.ts` — legacy single-pass route, superseded by `/orchestrate`
- The scripted `SCRIPTS` array in `web/lib/agent-router.ts` — replace with a single "agent unavailable" toast if `hasOpenRouterKey()` is false. The orchestrate route already gates on this.

---

## Sprints

Sprint 0 is mandatory. Subsequent sprints are roughly ordered, but
reorder by whichever metric is worst in the latest report.

### Sprint 0 — Foundation: eval harness + instrumentation

**Why first**: nothing else can be measured until this exists. Every
later sprint relies on the eval delta to gate merges.

**Build**:

- `web/agent-evals/corpus/queries.yaml` with **80 queries**.
  Devin writes these by hand (no synthetic generation, no LLM fanout
  — the seed corpus is curated, versioned, and small enough to read).
  Distribution intentionally **biased toward `marginal` and
  `multi_step`** since those are where the agent is weakest:

  - `layout` (10) — clear window manipulation
    *("split brief and graph", "focus the workflow", "clean slate")*
  - `content` (10) — pure content asks
    *("highlight notion-scribe", "compare slack and gmail", "explain bp-001")*
  - `multi_step` (20) — performative chains
    *("show me what's broken and explain why", "open the bug-triage workflow, scroll to step 3, and explain it")*
  - `marginal` (25) ← **headline subset**, weighted up. Tangentially
    UI-related, low signal-to-noise, waffly:
    *"I'm anxious about Friday"*,
    *"things feel off today, idk"*,
    *"hmm, can you check on stuff for me"*,
    *"my head's a bit foggy this morning"*,
    *"I keep forgetting what we said about the slack thing yesterday"*,
    *"it's like, you know, the integrations… I dunno"*,
    *"give me a vibe check"*,
    *"is everything fine?"*
    Devin should specifically craft queries that have real intent
    buried under conversational filler.
  - `failure_recovery` (10) — wrong slug, missing window, ambiguous
    reference: *"approve the slack thing"*, *"show me the X workflow"*
    where X doesn't exist
  - `edge_case` (5) — empty, hostile, contradictory:
    *""*, *"do nothing"*, *"open everything then close everything"*

- `web/agent-evals/corpus/expected.yaml` — per query:
  `must_include_tools[]`, `must_not_include_tools[]`,
  `expected_windows_after[]`, `judge_tags[]`. Strict-ish; the
  `marginal` entries deliberately allow multiple acceptable tool
  paths — the rule only requires that *some* meaningful canvas
  action happened (no empty turns) and that forbidden tools were not
  fired. Devin's judgement scores nuance later.

- `web/agent-evals/instrument.ts` — wraps `runOrchestrator` and the
  sub-agent factories. Captures per-tool start/end ms, retries,
  snapshot tokens, model tokens. Exports
  `runOrchestratorInstrumented(ctx, query)`.

- `web/agent-evals/run.ts` — for each query: build a fresh in-memory
  `AgentToolCtx`, run instrumented orchestrator against the live
  flash-lite endpoint, collect every event into a transcript, score
  the deterministic metrics, accumulate. Writes
  `reports/<date>-<sprint>-<sha>.json` containing
  `{ summary, metrics, queries: [{ query, transcript, deterministic, judge: null }] }`.
  Prints a markdown delta table to stdout (used in PR body).

- `web/agent-evals/judge.md` — short rubric Devin uses when reading
  transcripts to fill the `judge` field for each query (0-5 per
  axis + one-sentence rationale). Devin commits the updated report.

- `web/agent-evals/scripts/snapshot-rooms.mjs` — Playwright capture
  of post-turn canvas state for the `layout` and `multi_step`
  subsets, written to `reports/screenshots/`.

**Secrets**:

- `OPENROUTER_API_KEY` is required to run the eval. **Devin Cloud
  must request it via the secure secret-input flow** — do not
  hardcode, do not commit to `.env.example` with a value, do not echo.
  If the key isn't available, Devin opens a PR with the harness +
  corpus only and skips the baseline run, leaving a `BLOCKED:
  awaiting OPENROUTER_API_KEY` note in the sprint log.

**Wire**: `npm run agent:eval` (full 80) and `npm run agent:eval:quick`
(15 queries — 5 marginal + 5 multi-step + 1 each from the rest).

**Done means**:

- corpus + harness + rubric committed
- baseline report committed (or `BLOCKED` note if no key)
- all six north-star metrics have a current number
- PR template (`.github/PULL_REQUEST_TEMPLATE.md`) requires a delta
  table — already in place; verify still works
- legacy `web/app/api/agent/stream/route.ts` deleted; scripted
  `SCRIPTS` array in `web/lib/agent-router.ts` replaced with a single
  toast on missing key

---

### Sprint 1 — Snapshot & context engineering

**Wins targeted**: correctness, multi-step.

**Goal**: the agent should never ask for state it can already see.

- Extend `WindowSnapshot` with `viewState` per kind:
  - `scroll: { y_pct: number; visibleItemIds: string[]; totalItems: number }`
  - `selected: string | null`
  - `expanded: string[]`
  - `filters: Record<string, unknown>`
- Each room's module in `window-registry.ts` exposes a new
  `viewState(state)` alongside `summary(state)`.
- Server-side simulator (`server-snapshot.ts`) mirrors filter / select /
  scroll mutations so the agent's mid-loop view-state stays correct.
- Tighten `snapshotToPrompt`: drop redundant fields, lead with
  focused window's view-state, demoted windows get summaries only.
- **Budget enforcement**: a vitest/`.mjs` test fails if the
  4-windows-with-rich-view-state snapshot exceeds 350 tokens.

---

### Sprint 2 — Self-correction & dynamic step budget

**Wins targeted**: recovery, correctness.

- When a tool returns a failure-tagged message (`"No window matched"`,
  `"unknown slug"`, etc.), the sub-agent gets one bonus step.
  Implement as adaptive `stepCountIs` (start at 4, +1 per failure, cap 6).
- Emit `agent.tool.retry` SSE events; render in `SnapshotInspector`.
- Orchestrator system prompt: "if a sub-agent's tool returns a failure
  message, re-delegate with corrected intent before replying."
- Add `failure_recovery` corpus subset must improve ≥ 30 percentage
  points absolute or this sprint doesn't ship.

---

### Sprint 3 — Multi-step performativity prompt + presets

**Wins targeted**: mean tool calls per turn.

- Rewrite the orchestrator system prompt with explicit multi-step
  examples. Sample:

  > user: *show me what's broken*
  > → `delegate_layout("open stack as subject")`
  > AND `delegate_content("filter to warn, scroll to and highlight notion-scribe, push memory card with rate-limit context")`

- Add a `chain` cookbook section to each sub-agent prompt — five
  canonical chains (open→arrange→scroll→select→highlight, etc).
- Lift caps: orchestrator `stepCountIs(3)` → 4; layout 4 → 5; content 4 → 6.
- Verify latency p50 doesn't regress > 200ms; if it does, fix it in the
  same sprint.

---

### Sprint 4 — Coverage / "marginal intent" handling

**Wins targeted**: coverage subset.

- Expand the orchestrator's intent-resolution rules: feelings, vague
  status checks, calendar-adjacent asks all map to canvas actions.
- Try a one-shot `intent_classifier` pre-pass tool that returns
  `{layout-only | content-only | both | conversational | ambiguous}` and
  fills downstream prompts. **Keep only if it improves the marginal
  subset by ≥ 10 pp without regressing latency.** Otherwise rip out.
- Per-window summaries get tone-relevant fields (e.g. `brief.summary`
  includes `"3 deferrals from yesterday"`).

---

### Sprint 5 — Per-room tool gap audit (tools-only, no new UI)

**Wins targeted**: multi-step depth, correctness.

Audit each room and add what the agent needs to fully interact. Only
register tools that map to **existing** UI affordances. If a tool
"needs" a new component, defer to Sprint 7.

| Room | Tools to add |
|---|---|
| brief | `compare_proposals(a,b)`, `set_confidence_threshold`, `open_proposal_detail` *(only if a detail view already exists; else defer)* |
| graph | `pin_node`, `compare_nodes`, `filter_by_tag`, `set_zoom_anchor` |
| workflow | `step_focus(step_id)`, `explain_step`, `filter_by_tag` |
| stack | `tail_logs(slug, n)`, `filter_by_runtime`, `explain_warn` |
| playbooks | `open_detail`, `install`, `compare(a,b)` |
| settings | `toggle_integration`, `set_threshold(value)`, `search` |
| waffle | `replay_last_turn` |
| **all** | uniform read-only `<room>_status()` returning current view-state — agent uses when snapshot summary is stale |

**Done means**: every room has ≥ 8 tools; uniform naming
(`<room>_<verb>`); snapshot view-state covers each tool's state surface.

---

### Sprint 6 — Latency optimization

**Wins targeted**: TTFW, p50, p95.

- Move `snapshotToPrompt` output into a system-prefix the SDK can
  cache (provider must support; if not, no-op).
- Drop `temperature` to 0.2 across the board, A/B against eval.
- Pre-warm the OpenRouter HTTP client on first byte from the browser.
- Audit `streamText` for any blocking `await` between tool dispatch and
  SSE emit; the `arrange_windows` flow is the prime suspect.
- Hoist `WINDOW_REGISTRY[kind].summary()` calls into a single lazy
  memo per turn.

**Done means**: TTFW p50 ≤ 600ms. If not, document the bottleneck and
propose one architectural change for Sprint 7.

---

### Sprint 7 — UI rigor & edge-case safety pass *(only if eval surfaces failures)*

The first sprint Devin may modify UI markup. Allowed only if Sprints
0–6 evals reveal a class of intents that are unanswerable without new
UI. Examples Devin may justify:

- **brief**: a proposal-detail collapsible panel (sources, diffs,
  owner, confidence breakdown) — only if eval shows the agent can't
  answer "why is bp-003 only medium confidence"
- **workflow**: per-step inspector — only if "explain step 3" is a
  measurable failure mode
- **graph**: subgraph drill-down — only if "show me everything related
  to maya AND notion" can't be staged today

**Hard guardrails for any new component**:

- MUJI tokens only (`paper-*`, `ink-*`, `rule`, `accent-indigo`,
  `confidence-*`). No new colors. No new shadows beyond existing.
- Lowercase, sentence-case copy. No emojis.
- Smoke `.mjs` test in `web/tests/`.
- Playwright screenshot in `web/tests/room-shots/`.
- `data-testid` on every interactive element.
- New tools registered the same PR.
- Eval delta must show ≥ 5 pp improvement on at least one north-star
  metric, no regressions.

---

### Sprint 8+ — Backlog (Devin proposes, owner approves)

Reserved for whatever the eval reports surface next. Likely:

- Voice-mode prompt tuning (waffle room interplay)
- Cross-window animation choreography polish
- Memory-of-recent-turns: lift `recentActions` to a 2-turn window
- "Rehearsal" mode: dry-run tool sequence, ghost-preview, then commit

---

## Per-PR Definition of Done (enforced by template)

Every Devin PR must include:

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm run agent:eval` ran; report committed to `reports/`
- [ ] PR body has the markdown delta table (metric · before · after · Δ)
- [ ] If UI changed: smoke `.mjs` + Playwright screenshot + visual diff
- [ ] Sprint log at the bottom of this file updated with one paragraph

---

## Per-handoff prompt format

Each Devin Cloud handoff is one line:

> *Run Sprint N from `web/agent-evals/AGENTS.md` ([name]). Read the
> plan, request `OPENROUTER_API_KEY` via secure-secret-input if you
> don't have it, run baseline `npm --prefix web run agent:eval:quick`,
> ship the listed work, attach before/after report to PR body, update
> the sprint log.*

That's it. Devin reconstructs full context from this file.

**Reminder for every handoff**:

- Production model is `google/gemini-2.5-flash-lite`. Locked. Don't
  switch.
- The OpenRouter key is for the live UI agent only. Eval scoring's
  judgement axes are filled by Devin Cloud directly reading the
  committed transcripts — no other LLM calls.
- The headline metric is **marginal-intent pass-rate**. Optimize
  there first.
- Existing implementation is already solid. Sprints should be tight
  and stop early if metrics plateau.

---

## Risks

- **Eval cost** — 80 queries × ~3 turns × Flash ≈ $0.03/run; trivial.
  `--quick` is ~$0.005.
- **Prompt regressions are silent killers** — every prompt change must
  A/B against the corpus before merging.
- **Snapshot size creep** — Sprint 1 adds rich view-state; CI must fail
  on token-budget violation.
- **Legacy fallback removal** — deleting scripted `routeIntent` removes
  the demo-without-key safety net. Acceptable; orchestrate route
  already gates on `hasOpenRouterKey()`.
- **Devin session boundaries** — each sprint must be self-contained:
  passing tests, no half-finished snapshot schema migrations, no
  un-registered tools. Sprint log enforces this.

---

## Sprint log (Devin appends here every PR)

> **Format per entry**:
> `### Sprint N — [name] · YYYY-MM-DD · #PR-number`
> `Shipped:` one paragraph
> `Eval delta:` 6-row table
> `Regressions:` any, with rationale
> `Next:` which sprint to pick up

<!-- Devin: append entries below this line. Newest first. -->
