# Microbots

## The Pitch

**Microbots is the last SaaS subscription you'll ever need.** For non-technical founders and small teams, we're your constant voice memos and ambient memory—just talk, we remember everything. While you work, we automatically detect repetitive workflows across Gmail, Slack, Linear, and Notion, then sustain them through a living knowledge graph that captures intent without you managing a thing. No YAML, no APIs, no opinions required: chat naturally, and watch as overnight agents surface workflow candidates you can deploy with one click.

For the enterprise, it's the **same product, same architecture**—but with the Internet of Intelligence layer activated. Every agent action crystallizes into anonymized playbooks stored in SurrealDB, so your organization's workflows become reusable intelligence that compounds as you scale. Same core. Same interface. The difference is connectivity: your team's solutions automatically become starting templates for the next team.

---

## Architecture

### Novel Layered Disclosure: Markdown Registries as Graph Index

Instead of naive RAG dumping everything into context, we use **layered markdown registries** as a typed navigation spine:

- **Root registry** (`user.md`) links to domain layers (integrations, entities, skills, workflows)
- **Each layer** exposes `summary`, `drill_into`, and `indexed_by` sections
- **Agent navigation** uses `read_layer(layer_id)` to pull only the budgeted markdown for that layer
- **Polymorphic edges** (`memory_about`, `memory_informs`, `indexed_by`) let the agent traverse from any node to relevant context without stuffing full history

**Result**: Token budgets enforced at layer boundaries. The agent reads what it needs, when it needs it—no vector similarity drift.

### System 1 / System 2 Cognitive Model

| Mode | Trigger | Mechanism | Output |
|------|---------|-----------|--------|
| **System 2** | Voice/chat input | pydantic-ai agent with tool loop | Structured actions, memory writes |
| **System 1** | 6h cron / manual | Ralph-loop heartbeat: cluster → synthesize → propose | `workflow` candidates with `pending=true` |

### SurrealDB: Graph + Vector + FTS + Live Queries

One database replaces three systems:

- **8 node tables**, **16 polymorphic relations** with row-level `owner` permissions
- **HNSW indexes** (1536-dim, COSINE) for semantic similarity
- **Live queries** push mutations to browser in <500ms via WebSocket
- **Multi-tenancy**: Same schema for individual (single owner) and enterprise (cross-owner queries with shared `playbook` namespace)

### Render Two-Tier Execution

| Tier | Primitive | Use |
|------|-----------|-----|
| Interactive | Web Service | Voice, chat, live code |
| Async/Swarm | Workflows | Heartbeat, fan-out, promoted bots |

**Parallel fan-out as primitive**: `swarm(prompt, fan_out=N)` spawns N containers, each with independent Claude reasoning. The LLM treats distributed execution as a language feature.

### Bot Lifecycle: Live → Consulting → Rigid

1. **Live**: Full agent reasoning on schedule (expensive, forgiving)
2. **Consulting**: Mubit lessons displace reasoning with deterministic skills
3. **Rigid**: Devin crystallizes to PEP-723 `server.py` (50× cost drop, regresses to consulting if success drops)

### Internet of Intelligence (Enterprise)

- **Playbook namespace**: Privacy-stripped workflow structures (`confidence > 0.8` workflows → distilled templates)
- **Onboarding RAG**: New users get top-3 playbook suggestions based on toolkit overlap
- **Cross-user queries**: Fan out across N user graphs → org-wide answers

Same code. Same interface. Scale is the only difference.

---

## Stack

| Layer | Choice |
|-------|--------|
| Agent | pydantic-ai + Claude Opus 4.7 (BYO key) |
| Memory/Graph | SurrealDB v2 (HNSW + FTS + Live Queries) |
| Integrations | Composio MCP |
| Deploy | Render (Web Services + Workflows) |
| Voice | ElevenLabs (VAD, conversational) |
| Observability | Logfire + Mubit |
| Coding Agent | Cognition Devin |
