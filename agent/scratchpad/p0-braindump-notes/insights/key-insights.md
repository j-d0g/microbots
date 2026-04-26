# Key Insights — Morning Conversation 2026-04-25

> Three validated, pitch-or-architecture-changing insights from the morning conversation. Each is Jordan-originated or jointly developed under pressure-test. Implementation details (schema fields, retention policies, etc.) deliberately not captured here — they surface when the relevant code/schema work lands.

---

## 1. The the upstream stack-gap framing

**Insight.** the upstream stack ships two products in one — the upstream agent (the agentic chat) and the deployed workflow runtime — and the upstream agent is meaningfully better than the workflows it builds, because workflows lose the reasoning layer and reduce to plain LLM calls inside rigid Python. Users vote with their feet: they default to chat. **microbots' move is to collapse the two surfaces — every microbot is just an agent on a schedule.**

**Pitch line.** *"an upstream workflows are dumber than its chat — and that's why people use the chat. We collapse them."*

**Why it matters.** This is a defensible architectural pitch beat that other teams won't have. It explains WHY microbots is different from "Zapier with Claude" or "the upstream agent but for non-technicals." It also unifies the sponsor story: Mubit captures lessons that let agent-runs *graduate* into deterministic code; Devin handles that crystallization step. Without this framing, Mubit and Devin feel like bolted-on logos.

---

## 2. The card-deck / variable-reward morning brief

**Insight.** When the heartbeat consolidator surfaces workflow candidates, don't just rank by confidence. Mix the deck: 2 safe bets (high confidence, low complexity), 1 trophy build (high confidence, high complexity), 1 moonshot (lower confidence, high complexity). The moonshot is variable-reward — when it lands, the founder gets a kick; when it doesn't, the system learns. Confidence and complexity are *separate axes*, not one dimension.

**Pitch line.** *"microbots doesn't just suggest the easy stuff. It dares you to build the hard things — and when those land, your ecosystem just levelled up."*

**Why it matters.** Small product detail with outsized pitch impact. Judges remember details that suggest the system feels alive. It also gives Devin a natural slot inside the demo (moonshots route to Devin for scaffolding) without forcing Devin onto the critical path of a live demo. The IoA layer compounds the math: what's a moonshot for one founder becomes a safe bet for the next once the playbook graph proves the pattern — that's a network-effect line for individual capability.

---

## 3. The microbot lifecycle: live → consulting → rigid

**Insight.** A microbot starts as a *scheduled agent mission* (live mode — agent runs every step, supervised, expensive, forgiving). As Mubit captures lessons across runs, the agent can be consulted less often (consulting mode — deterministic skills displace reasoning at most steps). After enough stable runs, the pattern can be crystallized into deterministic Python (rigid mode — Devin scaffolds the code from the lesson set; cost drops ~50×). If success rate later drops, the microbot regresses back to consulting or live until it stabilizes again.

**Pitch line.** *"Microbots start expensive and smart, become cheap and rigid as Mubit captures lessons, and re-soften when they break."*

**Why it matters.** This is the System 1 self-improvement loop applied to *deployment*, not just memory. It's the answer to "what does Mubit actually do" (fuel for crystallization) and "what does Devin actually do" (write the deterministic code when the agent has proven the pattern). It also makes the demo safer — Accept on a workflow card commits a 10-line YAML mission config, not a 200-line Devin scaffold session. Devin moves to a stretch beat ("look, after 100 runs we crystallized this one"), not the critical path.

---

## Pointers (not duplicated here)

The broader overnight research (10 files, ~13.8k words on the upstream codebase, sponsors, kaig, ralph loop, atomic, etc.) now lives in `agent/research/`:

- `../planning/skimple.md` — distilled overview
- `*.md` — per-topic deep dives
- `../planning/design-v1.md` — formal design doc
- `../planning/plan-v1.md` — Friday→Sunday plan

See [`../README.md`](../README.md) for the full index.
