# 02 — Template / workflow discovery: multi-modal search

**Status:** raw brain dump (Jordan, 2026-04-26). Not a plan. Capture for later phase.

The harness needs a way to surface relevant existing workflows when a user asks for something. Three search modes that compose:

## 1. Semantic search

Find the 2–3 nearest-neighbour templates via embeddings. Vector search over template descriptions / tags.

## 2. Full-text search (agentic)

The agent reasons: *"From this request I suspect something related to X might be useful"* — then searches those keywords directly. Hint-driven, not query-as-typed.

Includes "social" hints: e.g. *"Osman is very similar in role to me in my organisation, so he might have workflows that would be useful to me."* The agent uses org-graph context to broaden the search to peers' workflows.

## 3. Graph traversal

Traverse the user graph: start from Osman → follow edges to his workflows / skills / integrations → surface anything relevant. Filesystem-traversal mental model.

→ **Detailed graph notes deferred to a later phase.** This is just a placeholder.

---

## Composition

The three modes likely run in parallel and merge results. Ranking + dedup happens after.

This ties directly to `search_templates` (P1 deferred tool) and to the broader IoA / cross-user-graph theme. Out of scope for V0; revisit when the skill/workflow graph has real content.
