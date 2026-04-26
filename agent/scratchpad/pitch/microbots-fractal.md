# Microbots — the fractal compose-and-swarm theme

**Status:** This is the narrative spine of the pitch. Every sponsor angle (Render, Composio, knowledge graph) is one expression of this theme. Lock this language and reuse it.

---

## The one-line pitch

> **"Microbots compose and swarm at every scale — within a workflow, across workflows, across an organization."**

Same primitive (parallel fan-out + recompose) repeats at three nested levels. The architecture is fractal. The story is fractal. That's why it sticks.

---

## The three levels

### Level 1 — Micro-workflows (within a bot)

A bot is one `@app.task`. Inside, it fans out to N sub-tasks via `asyncio.gather`. Each sub-task is itself a `@app.task` — it can fan out again.

```python
@app.task
async def build_profile(person):
    li, luma, google, twitter = await asyncio.gather(
        search_linkedin(person),  # ← own container
        search_luma(person),       # ← own container
        search_google(person),     # ← own container
        search_twitter(person),    # ← own container
    )
    return merge(person, li, luma, google, twitter)
```

**Render's brag** — recursive task chaining. The depth of the tree is unbounded. Each call boots its own isolated container.

### Level 2 — Microservices (across bots)

Multiple bots exist as named tasks or services. An orchestrator agent composes them. Sequential = chain. Parallel = swarm.

```python
@app.task
async def swarm_research(participants):
    # 150 build_profile calls in parallel — each one is itself a Level-1 fan-out
    return await asyncio.gather(*[
        build_profile(p) for p in participants
    ])
```

**The unique thing** — the agent (LLM) decides when to compose vs swarm vs sequence. The platform makes both ergonomic. Bots aren't a static DAG; the agent assembles them per-task.

### Level 3 — Distributed knowledge graph (across users)

Each user has their own knowledge graph (skills, workflows, integrations, ontology of intent). Bots run within a user's context and feed their graph. Cross-user queries fan out across user graphs.

```
Org-wide swarm:  "Find every team member who's worked with Vendor X"
                 → fan out across N user-scope graphs
                 → each user's bot queries their own graph
                 → reduce across users
                 → org-wide answer
```

**The vision** — Internet of Agents. Distributed intelligence. Same compose-and-swarm primitive, scaled to the org. This is post-V0; the architecture admits it; we don't ship it now but we narrate toward it.

---

## Why the fractal matters

It's not three different ideas glued together. It's **one idea** at three resolutions:

| Scale | Unit | Compose | Swarm |
|---|---|---|---|
| L1: micro-workflow | sub-task | chain `await` | `asyncio.gather` |
| L2: microservice | bot | sequence in agent | parallel tool calls |
| L3: graph | user-scope | cross-user query | org-wide fan-out |

A judge or a customer hears the pattern at one level and immediately understands it at all three. That's what makes a story sticky — one mental model unlocks the whole product.

---

## How the demo expresses the theme

The Luma/hackathon demo (proactive: agent sees Luma email → researches 150 attendees → finds teammates → drafts outreach) shows two of the three levels live and gestures at the third in the close.

| Demo moment | Level |
|---|---|
| `build_profile` fans out to 4 source searches | **L1** — micro-workflow |
| Orchestrator fans out 150 `build_profile`s | **L2** — microservices swarming |
| Closing line: *"Imagine this same pattern across your whole org's 60 teammates' graphs"* | **L3** — IoA gesture |

Two visible, one promised. That's the right ratio for a 90s demo.

---

## Why Render specifically (architecture-level)

The fractal needs a substrate that gives you both ephemeral and always-on primitives at every level. Most platforms pick one. **Render gives you both natively** — Workflows for ephemeral (L1 micro-workflows + L2 swarms), Web Services for promoted/persistent (L2 hot-path bots, L3 always-on listeners). One platform spans the whole fractal.

The alternative — CodeWords' actual stack — needs E2B (ephemeral) + EKS + ArgoCD + ECR + Terraform (always-on). Five platforms to express the same two-tier architecture. Render expresses it in one.

This is the architecture-level Render advantage and it ties directly into the fractal: same platform handles the same compose-and-swarm primitive at every scale.

Detail in `agent/scratchpad/pitch/render.md` under "The architecture-level advantage."

## How to talk about it (speaker notes)

**Opening hook:** *"Microbots aren't just microservices. They're agents that compose and swarm at every scale — and we use the same primitive at all of them."*

**Mid-demo (when dashboard lights up):** *"What you're seeing is recursive parallelism. Each box is its own container. Each box can spawn more boxes. The agent decides when to fan out — and Render Workflows makes that decision cheap."*

**Closing:** *"Today: 150 attendees in 50 seconds. Tomorrow: every member of your org with their own bot graph. Same shape. Same code. Different scale. That's microbots."*

---

## What this changes about every other pitch surface

- **Render section** of the pitch: leads with "the parallel-thinking primitive at every scale"
- **Composio section**: framed as "tool reach so each leaf can act on the world"
- **Knowledge graph section** (Desmond's track): framed as "where the third level lives — distributed bot memory across the org"
- **Demo intro**: starts with the fractal mental model, not the use case

Every sponsor is in service of a level of the same theme. No sponsor stands alone.

---

## Cross-references

- Render-specific talking points: `agent/scratchpad/pitch/render.md`
- Architectural decisions backing the harness: `agent/scratchpad/p1-harness-mvp/plan/01-findings.md`
- Knowledge-graph track (L3 substrate): `microbots/knowledge_graph/` + `agent/scratchpad/p0-braindump-notes/stack/surrealdb.md`
- Composable-workflow research: `agent/scratchpad/p0-braindump-notes/harness/runtime-pattern.md`
- Multi-modal template discovery (a future L2 expression): `agent/scratchpad/ideas/01-multimodal-template-discovery.md`
