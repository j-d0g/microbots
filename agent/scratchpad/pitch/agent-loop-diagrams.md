# Agent Loop — Pitch Notes

Two diagrams in Figma to talk through the microbots agent loop. Use these as
the visual spine for the pitch. Notes below are written so you can read the
diagram and narrate from it — not a script, just landmarks.

- **Reference (maximalist baseline):** https://www.figma.com/board/FTupkkCSesUX3heUvxCNHg
- **microbots v0 (lean):** https://www.figma.com/board/QaFaWoBRqd1aoOrrTXSgTL

> If you screen-share Figma, the first board's title still says "Cody" —
> rename it before the pitch (or open it pre-zoomed past the title).

---

## How the loop works (plain language)

A user types into a chat window. The chat UI runs an agent loop — a thin
streaming call (Vercel AI SDK over Anthropic Opus 4.7) where the model can
either write text back or pick a tool. When it picks a tool, the harness
runs the tool, returns the result into the model's context, and the loop
takes another step. Steps continue until the model decides it's done and
streams a final reply.

The loop itself is small — about a hundred lines. The interesting design
question is *what tools live behind it*. That's where the maximalist baseline
and the lean v0 diverge.

## The maximalist baseline (the reference diagram)

Seventeen tools, plus eight more rendered in the UI. Grouped by job they
fall into five buckets:

- **Knowledge** — the model searches a markdown corpus of guides and a
  template library before writing anything.
- **Build & Run** — separate tools for editing, viewing, validating,
  deploying, and running code.
- **Manage** — list workflows, list versions, pick which version is live.
- **Monitor** — check past runs, read logs, read outputs, cancel jobs.
- **Misc** — secrets and a self-scratchpad.

This shape made sense when models were weaker. Each tool exists because the
model couldn't be trusted to do that step on its own, or needed reference
material pinned in front of it every turn.

## microbots v0 (the lean diagram)

Four tools. The argument is that Opus 4.7 doesn't need most of that
scaffolding — it already knows how to write a Slack webhook, structure a
FastAPI endpoint, or handle async errors. What it doesn't know is the
platform's own contract — how a workflow declares itself, what env vars are
injected, how artifacts are stored. That fits in a 200-line system prompt,
not a RAG corpus.

So the v0 tools are:

- **`run_code`** — execute Python in a sandbox. One tool replaces validate,
  run, and run-workflow. The agent writes code, runs it, sees what
  happened, revises. Tight build-test-fix loop.
- **`save_workflow`** — persist current code as a deployable workflow and
  return a stable URL. Edit and deploy collapse into one act.
- **`find_examples`** — return two or three nearest templates with full
  source inline. No separate doc search.
- **`Ask_User_A_Question`** — defer to the human for confirmation gates.

The headline number for the pitch: **17 tools down to 4.** The story:
modern models need less harness, not more.

## Why this is the right cut for v0

Two principles drive the trim:

1. **Tools should do things the model can't do itself.** Side effects in
   the world — running code, persisting state, asking the user. Not
   knowledge retrieval, which Opus mostly already has.
2. **Compose over configure.** One general `run_code` beats five
   specialised execution tools. The model decides what to run; the harness
   just gives it a sandbox.

This also collapses the templates layer. Where the maximalist version
shipped a few megabytes of templates and a runtime contract spec, v0 ships
ten to twenty hand-curated examples (forty to eighty lines each) and an
inline contract. Smaller surface, faster iteration, easier to demo.

## Open question — memory as the differentiator

There's a stronger v0 cut not yet drawn: five tools instead of four, where
two of them search the user's own knowledge graph (Slack, Notion, Gmail,
Linear, GitHub) and their past workflows. That's the version where the
demo becomes "an agent that knows *you*" — pulling from real personal data
to write code grounded in the user's actual context. Worth flagging in the
pitch as the next move once the v0 loop is proven. The KG ingestion that
powers it already exists in the repo on `main`.

## Talking points cheat sheet

- The loop is small — a hundred lines, streaming, picks tools or writes text.
- Seventeen tools was right for weaker models. With Opus 4.7 it's overkill.
- Four tools is the lean cut: run code, save workflow, find examples, ask user.
- The trim is principled: tools do what the model can't, compose over configure.
- Next axis: memory. Search the user's own data — that's the moat.
