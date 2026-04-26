# 01 — Findings

What an agent in this repo wouldn't otherwise know about V1 tool design.
Anything inferable from general engineering is skipped. Decisions are
opinionated based on harness-engineering literature and adversarial
verification; treat the "How to apply" lines as hard rules unless
escalated.

---

## V0 was a "tour," not a builder loop

V0 ships four tools — `run_code`, `find_examples`, `save_workflow`,
`ask_user`. They demo well: the agent finds an example, runs Python,
saves the result. But the conversation only goes one way. Once a workflow
is saved, the agent has no way to read it back, run it as a deployed
artifact, or surface the user's prior work in a later session. The
second visit is amnesiac.

V1's job is closing that loop without inflating the tool surface
unnecessarily.

---

## The principle: tools should do what the model can't

Modern harness engineering converges on a small set of principles
(Anthropic engineering posts on tool-writing and context-engineering,
Thariq Shihipar's "Lessons from Building Claude Code" series,
HumanLayer's "Skill Issue: Harness Engineering" essay):

- **Few composable tools beat many narrow ones.** Every tool is
  decision-load and cache-prefix weight. ~20 tools is healthy for a
  Claude Code-class agent; more starts to hurt.
- **Tools should do things the model can't do itself.** Side effects in
  the world — sandbox execution, persistence, retrieval over private
  data, deferral to the human. Not knowledge retrieval the model already
  has.
- **The harness is cache-shaped.** System prompt, tool list, skill stubs
  all sit in the cached prefix. Stable tools = warm cache = fast +
  cheap. Mid-session tool swaps invalidate the whole prefix.
- **Tools that scaffold weaker models can constrain stronger ones.** A
  reminder tool useful for a smaller model can become a railroad for a
  bigger one. Re-evaluate periodically.
- **Memory lives on the filesystem, not in longer prompts.** Progress
  files, saved artifacts, plugin data dirs.

Each V1 tool earns its place by enabling a *new conversation type* the
agent couldn't hold without it.

---

## The four V1 additions, justified

### `view_workflow(name)` — the read-back partner of `save_workflow`

Without it the agent is permanently amnesiac about its own past output.
"Change my demo workflow to also send an email" is unanswerable; the
agent has the *name* but no way to see what's actually inside. Options
without `view_workflow` are: ask the user to paste the code (terrible
UX), regenerate from scratch (loses customisations), or hallucinate.
None acceptable.

This is the smallest tool — read a file by slug — but it's structurally
foundational. Iterate-on-existing is impossible without it.

### `run_workflow(name, args)` — invoke the saved artifact

Distinct from `run_code`. `run_code` executes ad-hoc snippets; this
loads `saved/<slug>.py` and runs it through the same Workflows runner.
The demo's actual closing beat: build, save, *run as a user*. Without
this, "save" is performative — the artifact exists on disk but the
agent's only path to execute it is to read it via `view_workflow` and
hand it back to `run_code`, which is a wasteful round-trip.

### `list_workflows()` — surface the user's prior work

Tiny tool. Returns saved workflows with one-line summaries, sorted by
most-recently-modified. Without it, "what have I built?" /
"show me my data ones" / "my slack one from yesterday" all fail —
the agent has no way to enumerate.

### `search_memory(query, scope)` — the differentiator

Searches the user's own data. Three scopes:

- `kg` — proxy to `kg_mcp`'s memories tool over streamable-HTTP MCP.
- `recent_chats` — rolling summaries of the user's last 1 / 7 days
  (honestly stubbed for V1; pipeline doesn't exist yet).
- `all` — both, merged.

This is the move that makes the agent specifically *yours*. Generic
template search (`find_examples`) returns the same results to every
user; `search_memory` returns content grounded in the caller's actual
context. "Build me a Slack summary bot for my #product channel,
mentioning my current sprint priorities" becomes possible.

---

## Architectural decisions

### D1 — Eight tools, no more

**Decision:** V1 tool surface is exactly `run_code`, `find_examples`,
`save_workflow`, `ask_user` (V0 carried forward) plus `view_workflow`,
`run_workflow`, `list_workflows`, `search_memory` (V1 additions). Total
= 8.

**Why:** Per the harness-engineering principle that ~20 tools is the
upper-healthy bound for a strong model. Eight gives generous headroom
for V2/V3 additions without already crowding the prefix. Each of the
four additions enables a conversation type that V0 cannot hold.

**How to apply:** Don't add tools without a written justification in
`notes/decisions-changed.md` (analogous to p1's convention). Adversarial
review must demonstrate the new tool unlocks something genuinely
unreachable via the existing eight.

### D2 — `search` is one tool with a `scope` arg, not multiple

**Decision:** `search_memory(query, scope: "kg" | "recent_chats" | "all")`.
Not separate `search_kg` / `search_chats` / etc.

**Why:** The three scopes share the same return contract (ranked results
with content). Three near-duplicate tools would inflate decision-load
without earning anything. One tool with a parameter is cleaner — the
model picks the scope based on intent, the harness routes to the
appropriate backend.

**How to apply:** If a future scope's return shape genuinely differs
(e.g. structured graph traversal results), then split. Until then, hold
the line at one tool.

### D3 — `search_memory` is wired to `kg_mcp`, not stubbed

**Decision:** V1 ships with `search_memory(scope="kg" | "all")` calling
`kg_mcp`'s `kg_memories_top` tool over streamable-HTTP MCP. ~50 LOC
inside the function body. Graceful degradation: returns
`{results: [], error: "kg_mcp unreachable"}` if the upstream service is
down rather than crashing.

**Why:** `kg_mcp` lives in this repo and exposes 13 tools; the closest
match to free-text search is `kg_memories_top`. Wiring it gives the
agent real-feeling retrieval today rather than an empty stub. The
substring-filter on top of `kg_memories_top` is crude but honest for V1;
a proper FTS/HNSW search tool on the `kg_mcp` side is a P3 follow-up.
There's no auth on `kg_mcp` today, so wiring is genuinely <50 LOC.

**How to apply:** Don't crash on upstream errors — `search_memory` must
always return the contract shape, with an `error` field if backends
fail. `recent_chats` stays stubbed regardless until the chat-summary
pipeline ships.

### D4 — `save_workflow` refuses overwrites by default

**Decision:** `save_workflow(name, code, overwrite: bool = False)`.
Returns `{error: "exists", slug, existing_bytes, hint}` on collision
unless `overwrite=True` is passed.

**Why:** Adversarial pass found that V0's `save_workflow` silently
overwrote on slug collision (e.g. "data sync" and "data-sync" both
slugify to `data-sync` and the second silently clobbered the first).
That's surprising data loss. Mechanical enforcement beats prompt-
engineering: the tool itself refuses, and the agent decides whether to
rename, ask the user, or opt in to overwrite.

**How to apply:** Don't widen this to "always overwrite" without a
written reason. The cost of a friction is a few extra tokens; the cost
of silent overwrite is the user's actual work.

### D5 — Hardening caps live in code, not prompts

**Decision:** `MAX_SLUG_LEN = 64` and `MAX_CODE_BYTES = 1_000_000` are
constants enforced inside the tool implementations, not described in
the system prompt.

**Why:** Adversarial probe sent a 1000-char workflow name and got an
unhandled `OSError` (Errno 63, file name too long). Adding "don't use
long names" to the prompt is unreliable — adversarial inputs come from
end users, not just the agent. Mechanical caps refuse cleanly with a
structured error.

**How to apply:** Treat the constants as stable. If a use case needs
larger code or longer names, raise them deliberately and rerun the
adversarial pass; don't unbound them.

---

## What we deliberately did not add

- **`validate_workflow`** — `run_code` covers it; a separate validator
  was reference scaffolding for weaker models that produced broken code.
- **`inspect_workflow_logs` / `cancel_workflow`** — operations console.
  Useful, but a debugging concern, not a builder-loop concern. V2.
- **Versioning tools** (`list_implementations`, `set_active_implementation`)
  — premature. Most users iterate, they don't accrete versions. V2.
- **`Set_Behavior_Mode`** — modes are scaffolding for weaker models.
  Opus 4.7 holds plans across turns without explicit mode-switching.
- **`todo_write`** — same reasoning. Opus 4.7's thinking phase covers
  the planning that `todo_write` was made to externalise.
- **Skills scaffolding** (folders with description-as-trigger) — a
  separate concern from tools. Worth a ticket of its own.
- **`ask_user` description rewrite** (delegate-before-asking, bundle-
  implications) — prompt engineering, not a code change. Separate
  ticket.

---

## Open follow-ups (deferred to p3 and later)

1. **Proper search on `kg_mcp` side.** The current `kg_memories_top`
   tool returns top memories without query filtering; the V1 wire does
   client-side substring filter. A proper `kg_search` (FTS / HNSW) on
   the `kg_mcp` side is the right shape and belongs upstream.
2. **`recent_chats` summarisation pipeline.** Per-session digests +
   daily and 7-day rollups. Exposed via the existing
   `search_memory(scope="recent_chats")` shape — no contract change
   needed.
3. **`ask_user` discipline.** Rewrite description to encode
   delegate-before-asking, bundle-implications, and "questions are
   commitments, not exploration."
4. **Skills layer.** Folders with description-as-trigger for the
   runtime contract, deploy mechanics, per-integration knowledge
   (`slack`, `gmail`, `notion`, `linear`).
5. **`kg_mcp` health.** During recon `kg-mcp-2983.onrender.com`
   returned 404 on `/health` and `/mcp`. Confirm whether this is
   free-tier cold-start, decommissioned post-event, or URL rotation.
   The wire degrades gracefully either way, but a real demo wants the
   service warm.
