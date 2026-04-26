# Ralph Loop — Research Notes (R3)

## TL;DR

Ralph Loop is the "Ralph Wiggum technique" pioneered by Geoffrey Huntley: a `while true` outer loop that re-feeds the SAME prompt to a coding agent over and over until the agent emits a completion token or hits an iteration cap. The official Anthropic plugin (`ralph-loop`) ports the pattern *inside* a single Claude Code session by hijacking the `Stop` hook so the session cannot exit — instead the hook re-injects the original prompt as the next user turn.

- It is a coding-iteration loop, not a consolidation/reflection loop.
- "Self-referential" only because each iteration sees its own past file edits + git history.
- Completion is signalled by Claude emitting a literal `<promise>PHRASE</promise>` tag (exact-string match) or by reaching `--max-iterations`.
- No checkpointing, no reflection step, no spec-vs-result review; it is a tight retry/refine cycle.

## Evidence found

- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/` — canonical plugin source (the `data/ralph-loop-claude-plugins-official/` and `data/ralph-loop-inline/` dirs are empty install-state shells; the real code is here):
  - `.claude-plugin/plugin.json` — name, v1.0.0, authored by Anthropic.
  - `README.md` — describes Ralph as "Ralph is a Bash loop", explicitly cites `https://ghuntley.com/ralph/` and mike-o-brien/ralph-orchestrator. Reports anecdata: "6 repos generated overnight in YC hackathon testing", "$50k contract done for $297 in API costs".
  - `commands/ralph-loop.md` — slash command `/ralph-loop "<prompt>" --max-iterations N --completion-promise "<text>"`.
  - `commands/cancel-ralph.md` — `/cancel-ralph` deletes state file.
  - `commands/help.md` — explains pattern as `while :; do cat PROMPT.md | claude-code --continue; done`.
  - `scripts/setup-ralph-loop.sh` — writes `.claude/ralph-loop.local.md` containing YAML frontmatter (`active`, `iteration: 1`, `session_id`, `max_iterations`, `completion_promise`, `started_at`) and the prompt body.
  - `hooks/hooks.json` — registers a single `Stop` hook.
  - `hooks/stop-hook.sh` — the heart of it. Reads transcript, looks for `<promise>...</promise>` in the last assistant text block, decrements/checks iterations; if not done, returns `{"decision":"block","reason":<original prompt>,"systemMessage":"Ralph iteration N | ..."}` to force Claude to keep going.
- `<internal-source>` vs `<internal-source>` diff: the pre-ralph-loop snapshot is just a generic timestamped backup of the upstream repo. Many divergences are unrelated (CI workflows, container changes, schema). The only ralph-loop-correlated artifact is the *absence* of `.claude/ralph-loop.local.md` and `.worktrees/` in the snapshot. There is no upstream-specific "ralph integration" — ralph-loop is purely a Claude harness plugin, not an upstream repo feature.
- `<internal-claude-projects-path>` — exists but I did not need to grep it; the worktree name `poweruser-ralph` confirms Jordan ran a ralph experiment in a dedicated worktree at some point.

## Pattern

The loop, in plain terms:

1. User runs `/ralph-loop "<prompt>" [--max-iterations N] [--completion-promise PHRASE]` once.
2. Setup script writes a markdown+frontmatter state file at `.claude/ralph-loop.local.md` containing the prompt and counters, and pins the loop to the current `session_id` so other sessions in the same project are not affected.
3. Claude works on the task normally — edits files, runs tests, etc.
4. When Claude tries to end its turn (Stop event), the hook fires:
   - If state file missing or session mismatch → allow exit.
   - If `iteration >= max_iterations` → delete state, allow exit.
   - Else parse last assistant text block, check for the literal `<promise>PHRASE</promise>` tag (exact match, not glob). If present → delete state, exit.
   - Otherwise: increment `iteration`, return JSON `{decision: "block", reason: <original prompt>, systemMessage: "Ralph iteration N"}`. Claude is forced to re-read the same prompt as a new user turn.
5. Repeat. Files persist across iterations, so each turn sees the prior work — that is the only "memory" mechanism. There is no summary, no reflection prompt, no scratchpad updated by the hook.

The pattern's strengths:
- Zero external orchestration — works inside one Claude Code session via a single Stop hook.
- Deterministic exit conditions (max iters OR exact promise tag).
- The hook is small (~190 lines of bash) and corruption-tolerant (deletes state and exits cleanly on parse failures).

The pattern's gaps relative to System 1 / consolidator needs:
- No notion of "checkpoint and reflect". The same prompt is replayed verbatim; there is no "review what you did, adjust the spec" step.
- No explicit spec→execute→review→adjust cycle. Drift is supposed to self-correct because the prompt is unchanging and files persist, not because of a structured review.
- Single-session, single-project scoped. Cannot fan out to subagents or aggregate findings.
- Coding-task framing throughout: README/help explicitly say "good for: TDD, getting tests to pass, greenfield code; bad for: human judgment, design decisions, unclear success criteria".
- No data clustering / aggregation primitives. Just iterate-on-prompt.

## Recommendation for microbots

**Adapt the spine, do not borrow wholesale.**

What is worth stealing for the microbots overnight CONSOLIDATOR:
- **Stop-hook-as-loop-driver**: same architectural trick (block exit, re-inject input) is a clean way to keep a long-running session alive without an external `cron`/`while true` wrapper. Lower ops surface than a separate tmux daemon.
- **State file at `.claude/<feature>.local.md`** with YAML frontmatter for iteration count, started_at, session_id pinning, and a body. This is a nicely minimal scheme and we should mirror it (`microbots-consolidator.local.md`).
- **Exact-string completion sentinel** (`<promise>...</promise>`). Cheap, robust, model-friendly.
- **Numeric iteration cap as the always-on safety net** — Jordan's `.claude/CLAUDE.md` Safety pillar matches this directly.

What does NOT fit microbots' consolidator and should be redesigned:
- **Same-prompt re-injection is wrong for consolidation.** Clustering molecular actions while the user sleeps needs the prompt to evolve: "here are the clusters you produced last iteration, here are the new actions since, refine." Ralph deliberately does NOT do this. We need a "rolling state" injection, not a static prompt.
- **No reflection step.** Microbots needs an explicit "reflect → adjust → continue" cadence — closer to a spec/plan/execute/review loop than Ralph's single-prompt grind. Borrow the hook mechanism but inject a *templated* prompt that includes a digest of prior iterations.
- **Single-session scope.** Consolidator may want to spawn parallel review subagents (per cluster) before re-converging. Ralph has no answer for that.
- **Coding-task framing.** The "deterministically bad, files persist as memory" assumption breaks down for consolidation: our memory is not in working-tree files, it is in the molecular-action store / vector DB.

Verdict: **borrow the hook + state-file + sentinel pattern; replace the static-prompt heart with a reflect-and-replan template that reads accumulated cluster state**. Treat ralph-loop as the minimum viable scaffolding (≈190 LOC of bash) we extend into the System 1 consolidator, not as a turnkey solution.
