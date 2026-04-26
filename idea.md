# Microbots

## The Pitch

**Microbots is the last SaaS subscription you'll ever need.** For non-technical founders and small teams, we're your constant voice memos and ambient memory—just talk, we remember everything. While you work, we automatically detect repetitive workflows across Gmail, Slack, Linear, and Notion, then sustain them through a living knowledge graph that captures intent without you managing a thing. No YAML, no APIs, no opinions required: chat naturally, and watch as overnight agents surface workflow candidates you can deploy with one click.

For the enterprise, it's the **same product, same architecture**—but with the Internet of Intelligence layer activated. Every agent action crystallizes into anonymized playbooks stored in SurrealDB, so your organization's workflows become reusable intelligence that compounds as you scale. Same core. Same interface. The difference is connectivity: your team's solutions automatically become starting templates for the next team.

---

## Architecture

### Core Design: Fractal Compose-and-Swarm

The architecture repeats the same primitive—parallel fan-out with reduction—at three nested scales:

| Level | Unit | Compose | Swarm |
|-------|------|---------|-------|
| **L1: Micro-workflows** | Sub-task | `await` chain | `asyncio.gather` |
| **L2: Microservices** | Bot | Sequential agent | Parallel tool calls |
| **L3: Distributed Graph** | User scope (individual) / Org scope (enterprise) | Cross-query | Cross-user fan-out |

This is not three different systems. It is one mental model, three resolutions. Individual and enterprise run identical code paths—enterprise simply enables cross-user graph queries.

### Input Layer: Voice & Chat (The WhisprFlow Pattern)

**Just talk. We remember.**

- Voice memos transcribed and embedded into the graph as `chat` nodes
- Ambient context capture: every integration touch becomes a memory
- No structured input required—the agent extracts intent from unstructured ramble

The UI agent is optimized for marginal intent: extracting real work from conversational filler, vague status checks, half-formed thoughts. The same system serves individuals capturing shower thoughts and executives recording meeting notes.

### Cognitive Model: System 1 / System 2

Borrowing from Kahneman:

- **System 2 (Daytime)**: User-driven. Voice memo or chat triggers first-principles reasoning. The agent navigates a user-scoped ontology graph, calls Composio integrations, and writes every observation back as typed nodes (`chat`, `memory`, `entity`, `skill`).
- **System 1 (Overnight)**: Autonomous heartbeat. A Render Cron Job runs every 6 hours, reads new `chat`/`memory` rows, encodes via embeddings + tags, clusters via HNSW + FTS hybrid search, and surfaces `workflow` candidates with `pending=true`. The morning brief renders these as approval cards.

**Same pipeline, two modes**—whether you're a solo founder or a 500-person org.

### The Memory Spine: SurrealDB v2

A single database layer replaces three separate systems:

- **Graph**: 8 node tables (`user_profile`, `integration`, `entity`, `chat`, `memory`, `skill`, `workflow`, `layer_index`) with 16 polymorphic relations including `memory_about`, `memory_informs`, `indexed_by`
- **Vector**: HNSW indexes on all content nodes (1536-dim, COSINE) for semantic similarity
- **Full-Text Search**: Analyzers on chat content for keyword recovery
- **Live Queries**: WebSocket subscriptions push graph mutations to the iframe in <500ms—every node the agent writes appears in real time

**Multi-tenancy**: Row-level `owner` fields + table `PERMISSIONS`. For individuals: one owner. For enterprise: same schema, queries fan out across owners with shared `playbook` namespace.

### Integration Layer: Composio MCP

Zero-config tool access via Model Context Protocol:

```python
# One line: MCP server auto-registers all connected toolkits
composio.create(user_id, toolkits=["gmail", "slack", "linear"]).mcp.url
```

Auth is in-product: Composio hosts OAuth consent screens. We never touch raw secrets. 20k free calls/month covers early usage.

### Execution Substrate: Render Two-Tier

| Tier | SLA | Render Primitive | Use Case |
|------|-----|------------------|----------|
| Interactive | <2s ideal, <5s acceptable | **Web Service** | Chat, voice processing, live code execution |
| Async/Fan-out/Cron | Minutes acceptable | **Workflows** | Heartbeat, swarm tasks, promoted bots |

**Parallel fan-out as primitive**: The agent emits `swarm(prompt, fan_out=N)`. Render Workflows spawns N isolated containers, each running independent Claude reasoning, and reduces results. The LLM treats distributed execution as a built-in language feature.

**Why Render over E2B**: E2B is sandbox-only. To support always-on services (webhook listeners, hot-path APIs), E2B stacks bolt on Kubernetes + ArgoCD + ECR + Terraform—five platforms. Render gives us both ephemeral (Workflows) and always-on (Web Services) natively in one platform with one deploy pipeline and one dashboard.

### The Bot Lifecycle: Live → Consulting → Rigid

Microbots graduate from expensive reasoning to cheap determinism:

1. **Live**: Scheduled agent mission. Full Claude reasoning every step. Supervised. Expensive. Forgiving.
2. **Consulting**: Mubit captures lessons from runs. Deterministic skills displace reasoning at most steps.
3. **Rigid**: Devin crystallizes proven patterns into deterministic Python (PEP-723 `server.py`). Cost drops ~50×. If success rate drops, the microbot regresses back to consulting or live until stable.

This applies System 1 self-improvement to deployment, not just memory.

### Workflow Primitive: PEP-723 `server.py`

Promoted workflows deploy as standalone Python scripts:

```python
# /// script
# requires-python = ">=3.11"
# dependencies = ["fastapi", "structlog", "composio"]
# ///

from fastapi import FastAPI
from pydantic import BaseModel

@app.post("/")
async def triage(req: TriageRequest) -> TriageResponse:
    # Deterministic workflow logic
    ...
```

Devin scaffolds the code from lesson sets. Render REST API (`POST /v1/services`) deploys it as a fresh Web Service with its own URL and Cron schedule.

### The Internet of Intelligence (IoI): Enterprise Differentiator

**Same product, connected graphs.**

A separate SurrealDB namespace `microbots_playbooks` stores distilled workflow templates:

- `playbook`: Anonymized structure (description, trigger, outcome, tool sequence, schema requirements)
- `playbook_entity`: Privacy-stripped entity types (e.g., "investor", "support_ticket")
- `originated_from`: Anonymous edge to source signature—no PII

**Distillation pipeline** (runs nightly):
1. Read `workflow` rows across user namespaces where `deployed=true`, `confidence > 0.8`
2. Strip private state—keep structure (entity types, action sequences)
3. Cluster across users; emit `playbook` rows
4. Index via embeddings on description + tool set

**Onboarding RAG**: New users query playbooks where toolkit overlap ≥ 50% → suggest top 3 to adopt. Adoption = clone playbook into user's `workflow` namespace as `pending=true`.

**The enterprise moat**: Your organization's collective intelligence compounds. Today's solution becomes tomorrow's template. Cross-user queries fan out: "Find every team member who's worked with Vendor X" → fan out across N user-scope graphs → reduce to org-wide answer.

Same code. Same interface. The only difference is scale.

### Agent Loop: pydantic-ai + Logfire + BYO Keys

```python
Agent[AgentDeps, AgentOutput](
    model='anthropic:claude-opus-4-7',
    tools=[read_layer, traverse, search_hybrid, write_memory, propose_workflow, composio_mcp...],
    output_type=AgentOutput,  # Structured HTML cards or text
)
```

- **BYO API key**: Users paste Anthropic keys; we encrypt with Fernet, store per-user. No OAuth gatekeeping.
- **Logfire**: Automatic instrumentation of pydantic-ai + FastAPI traces.
- **Mubit**: Wraps the Anthropic client to capture lessons that fuel crystallization.

Tool surface is minimal but complete: `read_layer(layer_id)` for graph navigation, `traverse(from_id, edge)` for hops, `search_hybrid(query)` for recovery, `write_memory` for persistence, `propose_workflow` for candidate emission.

### UI: Live-Query Iframe

Vanilla JS + SurrealDB JS SDK over WebSocket:

```javascript
const live = await db.live(new Table("memory"), (action, result) => {
  graph.upsert(result);  // D3/Cytoscape updates in real time
});
```

Every graph write the agent performs pushes to the browser in milliseconds. The demo: founder asks a question, the graph lights up live as the agent reads, writes, clusters. No polling. No refresh.

### Overnight Consolidator: Ralph-Loop Scaffold

The heartbeat runs a reflect-replan loop:

1. Read new `chat`/`memory` since last run
2. Embed + cluster via hybrid search (FTS + KNN + tag overlap)
3. Per cluster meeting threshold: synthesize workflow candidate via LLM
4. Write candidate with `pending=true`, `confidence`, `complexity`
5. Exit when no new clusters surface for N iterations

Four-quadrant morning brief: 2 safe bets (high confidence, low complexity), 1 trophy build (high confidence, high complexity), 1 moonshot (lower confidence, high complexity). Variable reward keeps users engaged.

---

## Individual vs Enterprise: Same Product, Different Scale

| Feature | Individual / Small Team | Enterprise |
|---------|------------------------|------------|
| **Input** | Voice memos, chat | Voice memos, chat |
| **Memory** | Personal knowledge graph | Personal + shared playbook graph |
| **Workflow detection** | Overnight clustering | Overnight clustering |
| **Deployment** | One-click Render deploy | One-click Render deploy |
| **Cross-user** | N/A | Full IoI: playbooks, org-wide queries, collective intelligence |
| **Schema** | Single `owner` | Same schema, `owner` filters + shared `playbook` ns |

**The power**: A solo founder's workflows automatically become enterprise-grade templates as they grow. No migration. No new interface. Just connectivity enabled.

---

## Technical Moats

1. **Schema-as-moat**: The `layer_index` + `drills_into` + `indexed_by` graph pattern gives token-budgeted navigation that pure vector stores cannot match.

2. **Sponsor-native architecture**: SurrealDB, Logfire, Render, Devin, Mubit, Composio all land naturally—not bolted on, but load-bearing.

3. **Collapse chat and deployed workflows**: Unlike competitors where deployed workflows are dumber than chat, microbots are agents on schedules—same reasoning layer, different durability.

4. **Deterministic crystallization**: The Live→Consulting→Rigid lifecycle turns expensive agent runs into cheap, maintainable code without losing the upgrade path back to reasoning when patterns break.

5. **Unified individual/enterprise**: No product split. The enterprise feature is simply cross-user graph queries on the same codebase.

---

## Stack

| Layer | Choice |
|-------|--------|
| Language | Python 3.11+, async |
| Agent Framework | pydantic-ai v1.86.1 |
| Web | FastAPI |
| Memory/Graph/Vector/FTS | SurrealDB v2 |
| Frontend | Vanilla JS + SurrealDB JS SDK over WS |
| Integrations | Composio (MCP-native) |
| LLM | Anthropic Claude Opus 4.7 (BYO key) |
| Deploy | Render (Workflows + Web Services) |
| Observability | Pydantic Logfire |
| Execution Memory | Mubit (alpha) |
| External Coding Agent | Cognition Devin |
| Voice (implied) | Transcription + embedding pipeline |
