> **Snapshot status (overnight ralph loop):** v1 architectural design doc as of 2026-04-25 ~04:00. Several key decisions made *after* this doc — workflow=scheduled-agent-mission reframe, lifecycle live→consulting→rigid, supersedes/`valid_to`/retention by memory_type, four-quadrant confidence×complexity suggestion deck — are NOT yet incorporated. They live in handoff.md and chat history pending a reconciliation pass into `agent/DESIGN.md`.
>
> Repo layout has reorganized since this was written: `schema/`, `scaffold/`, `docs/specs/` referenced here are superseded by `knowledge_graph/` for the DB layer and by `agent/` for harness work.
>
> **Use for:** ICP, System 1/2 framing, sponsor map, demo narrative, multi-tenancy approach, BYO-key auth, observability/Mubit wiring.
>
> **Don't use for:** literal file paths, schema migration text, Render layout (will change with mission-config reframe), Devin demo plan (downgraded to optional crystallization beat post-reframe).

# microbots — Design Document

**Authors:** Claude (overnight ralph loop) — for review by Jordan, Desmond, Artem
**Date:** 2026-04-25
**Status:** Draft v1, awaiting team review
**Branch:** `research/2026-04-25-overnight`

> **How to read this doc:** start with [skimple.md](skimple.md) for the executive summary. This document is the formal spec the team references during implementation; it defers nuance to the other files in this `research/` folder.

---

## 1. Background and motivation

### 1.1 What we're building

microbots is an opinionated coding-agent harness for **non-technical startup founders**. They connect their integrations (Slack, Gmail, Linear, Notion, GitHub) once. From that point on, the system:

- Builds a user-scoped ontology graph of their "SaaS empire" — people, tools, entities, activity
- Lets them chat naturally to drive deliberate work (System 2: daytime)
- Distills repeated actions into workflow candidates while they sleep (System 1: overnight)
- Promotes accepted candidates into deployed Python microservices ("microbots") that run on schedule
- Federates distilled patterns across users via an Internet-of-Agents (IoA) playbook layer for enterprise

### 1.2 Why this wins the hackathon

Three reasons:

1. **All five sponsors land naturally.** SurrealDB is the spine; Logfire is one decorator; Render is the deploy substrate; Cognition/Devin is the promotion beat; Mubit is the lessons layer. Composio (stack pick) handles multi-user OAuth. No sponsor is grafted on.
2. **The pitch has a structural moat.** The "harness is the moat" thesis pressure-tested correctly — outsourcing the loop to LangGraph or Devin gives away the differentiation. We own the loop and rent muscle.
3. **The IoA reveal scales B2C → enterprise** without a rebuild. Per-user graph + privacy-stripped playbook graph means *"your microbots talk to their microbots via the entities you share"* lands as a YC-resonant sentence.

### 1.3 Time-box

**Hackathon weekend:** Friday 2026-04-25 → Sunday 2026-04-27 evening pitch. Target: working live demo + benchmark numbers + clean pitch.

## 2. Goals and non-goals

### 2.1 v0 goals (Friday-Saturday)

- A founder can sign up, paste an Anthropic API key, connect 3 Composio integrations (Gmail/Slack/Linear) in <2 minutes
- Agent loop can answer "what does X use Slack for" using only the graph (no live API calls)
- Agent can ingest a real Gmail inbox via Composio and write `chat` + `memory` rows to the graph
- iframe UI shows the graph and updates live (<500ms) as the agent writes
- Heartbeat consolidator runs on a schedule, clusters new chats, proposes workflow candidates
- One end-to-end demo: morning brief shows a workflow candidate; founder clicks accept; new microbot deploys to Render

### 2.2 v1 goals (Saturday stretch)

- Devin promotion path live (or hybrid: live + recorded fallback)
- IoA playbook graph with cross-user distillation (privacy-stripped)
- Bench harness: 5 founder tasks vs Claude / Perplexity, recorded scores

### 2.3 Non-goals (this weekend)

- Production-grade auth (Auth0/Clerk) — paste-key + per-user JWT is enough
- Real Render deploy of every promoted microbot — one is enough for the demo
- Robust error handling around Composio rate limits — surface and reconnect, don't retry intelligently
- agents.md auto-regeneration pipeline — manual edits OK for v0
- Any browser-agent fallback for missing Composio integrations — defer
- Multi-org / multi-user-within-org — single founder per signup
- Embedding generation pipeline — placeholder vectors are fine for the demo

## 3. ICP — startup founder

The product is opinionated specifically for startup founders. This shapes:

- **Integration set:** Slack, Gmail, Linear, Notion, GitHub (founder bread-and-butter)
- **Pattern bias:** investor updates, customer triage, hiring pipeline, product ops — repetitive multi-tool flows
- **Vocabulary:** "deal", "candidate", "investor", "customer", "feature" as graph entity types
- **Demo pitch surface:** YC-startup-school adjacent — "the empire assembles itself while you sleep"

Per WhatsApp thread, the team confirmed this ICP narrowing.

## 4. Cognitive model — System 1 / System 2

Borrowing Kahneman:

- **System 2 (daytime, user-driven):** founder asks for something. Agent reasons first-principle, navigates the graph via `read_layer`, calls Composio tools, drafts work, writes results back to the graph. Every chat turn, every tool call, every accepted/rejected suggestion becomes a tagged node.
- **System 1 (overnight, autonomous):** consolidator runs on schedule (Render Cron Job, ~6h). Reads new `chat`/`memory` rows, encodes (tags + embeddings), buckets by similarity, surfaces structure (repeated action sequences → workflow candidates; related entities → domains; chains of workflows → meta-workflows). Writes candidates with `pending=true`.

The morning brief renders pending candidates as cards. Acceptance = promotion.

This is the central metaphor: small microbots compound and self-organize overnight. The empire assembles itself while you sleep.

## 5. Architecture

### 5.1 Component map

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (founder)                                               │
│  ┌────────────────────┐  ┌──────────────────────────────────┐   │
│  │  Chat UI           │  │  Live Graph Iframe                │   │
│  │  (SSE stream)      │  │  (SurrealDB JS SDK over WS)       │   │
│  └─────────┬──────────┘  └────────────────┬─────────────────┘   │
└────────────┼──────────────────────────────┼─────────────────────┘
             │ HTTP/SSE                     │ WebSocket /rpc
             │                              │
┌────────────▼─────────────┐    ┌───────────▼────────────────────┐
│  FastAPI app (Render)    │    │   SurrealDB v2                 │
│                          │    │   (Surreal Cloud or self-host) │
│  ┌────────────────────┐  │    │                                │
│  │ pydantic-ai Agent  │──┼────┤   Schemas:                     │
│  │ (Claude Opus 4.7)  │  │    │   - 8 nodes / 16 relations     │
│  │                    │  │    │   - HNSW + FTS                 │
│  │ Tools:             │  │    │   - layer_index navigation     │
│  │ - read_layer       │  │    │   - row-level owner perms      │
│  │ - traverse         │  │    │                                │
│  │ - search_hybrid    │  │    │   Live queries:                │
│  │ - write_memory     │  │    │   - memory                     │
│  │ - propose_workflow │  │    │   - layer_index                │
│  │ - composio MCP ────┼──┼────┤   - workflow (pending=*)       │
│  └────────────────────┘  │    │                                │
│                          │    └────────────────────────────────┘
│  Logfire instrumentation │
│  Mubit wrapper           │
└──────────────────────────┘
             │
             │ Render REST API (programmatic)
             ▼
┌──────────────────────────┐    ┌────────────────────────────────┐
│  Render Cron Job         │    │  Render Web Service per        │
│  (heartbeat consolidator)│    │  promoted microbot             │
│                          │    │  (one server.py FastAPI app)   │
│  ralph-loop scaffold +   │    │                                │
│  templated reflect-replan│    │  Optional: Devin scaffolds it  │
└──────────────────────────┘    └────────────────────────────────┘
```

### 5.2 Request flow (System 2)

1. Founder types in chat UI
2. FastAPI handler delegates to `agent.run_stream(prompt, deps=ctx)`
3. pydantic-ai loop: pick tool → call → integrate → repeat until done
4. Tool calls hit either:
   - Composio MCP (Gmail/Slack/Linear actions)
   - Native SurrealDB toolset (`read_layer`, `traverse`, `search_hybrid`, `write_memory`, `propose_workflow`)
5. Each `write_memory` / `propose_workflow` triggers SurrealDB live-query push to the iframe → graph updates
6. Final structured output streams back to chat UI (HTML card or text)
7. Logfire records the entire trace; Mubit captures lessons

### 5.3 Heartbeat flow (System 1)

1. Render Cron Job fires every 6h (configurable; demo uses on-demand trigger)
2. Reads new `chat` and `memory` rows since last run (`created_at > $last_consolidation`)
3. Embeds + clusters via SurrealDB hybrid search (FTS + KNN + tag overlap)
4. Per cluster meeting threshold: writes `workflow` candidate with `pending=true`, `description`, `trigger`, `outcome` derived from cluster centroid
5. Updates `_consolidator_runs` table with timestamp + cluster count
6. Morning brief = `SELECT * FROM workflow WHERE pending = true ORDER BY confidence DESC LIMIT 5`

The loop scaffold borrows from Geoffrey Huntley's ralph-loop (~190 LOC bash → port to Python). Replace static-prompt-replay with templated reflect-and-replan that injects accumulated cluster state. Exit when no new clusters surface for N consecutive iterations.

### 5.4 Promotion flow

1. Founder clicks Accept on a workflow candidate card
2. Frontend POSTs to `/promote` with `candidate_id`
3. Backend builds a spec template combining:
   - The candidate's `description`, `trigger`, `outcome`
   - SurrealQL schema (as Devin Knowledge entry)
   - Composio tool list relevant to the workflow
   - The PEP-723 `server.py` template (stolen verbatim from Agemo runtime)
4. Two paths run in parallel:
   - **Live path:** `POST /v3/organizations/{org}/sessions` to Devin with the spec + a fresh repo URL
   - **Recorded path:** pre-recorded Devin session video starts playing in iframe (synthetic timing)
5. If Devin returns a PR within ~3 min, swap recorded → live; otherwise the recorded happy path completes and the canned PR appears
6. Either way: a new GitHub repo exists with `server.py`. Backend calls Render REST API (`POST /v1/services`) to deploy it
7. Backend writes `workflow:{slug}` node with `pending=false, deployed=true, render_service_url=...` → live query updates iframe

### 5.5 IoA layer (V1, Saturday)

A separate SurrealDB namespace `microbots_playbooks` (same database server). Single user per ns is the system. Schema:

- `playbook` — distilled workflow template (description, trigger, outcome, server.py source, composio_tools, schema_requirements)
- `playbook_entity` — anonymized entity types (e.g., "investor", "support_ticket")
- `playbook_pattern` — sequences of skill IDs
- `originated_from` — anonymized edge to source user_id (privacy-stripped: only stack_signature stored)

Distillation pipeline (runs nightly, separate Cron Job):
1. Read `workflow` rows across user namespaces where `deployed=true`, `confidence > 0.8`
2. Strip private state (entity names, message content) — keep structure (entity types, action sequences)
3. Cluster across users; emit `playbook` rows
4. Index via embeddings on description + tool set

Onboarding RAGs the playbook graph: at signup, after first 3 toolkits connected, query playbooks where toolkit overlap ≥ 50% → suggest top 3 to adopt. Adoption = clone playbook into user's `workflow` namespace as `pending=true`.

## 6. Data model

See `/Users/jordantran/Agemo/agent-workspace/schema/*.surql` for the actual SurrealQL definitions. Highlights:

- **8 node tables:** `user_profile`, `integration`, `entity`, `chat`, `memory`, `skill`, `workflow`, `layer_index`
- **16 relations** including polymorphic edges (`memory_about IN memory OUT entity | integration`, `memory_informs IN memory OUT skill | workflow`, `indexed_by IN ... OUT layer_index`)
- **HNSW indexes** on `entity.embedding`, `chat.embedding`, `memory.embedding`, `skill.embedding`, `workflow.embedding` (1536-dim, COSINE)
- **FTS analyzers** on chat content and other text fields

### 6.1 Schema additions for v0

To support the design above, we add these on top of the existing schema:

```sql
-- _consolidator_runs: heartbeat audit
DEFINE TABLE _consolidator_runs SCHEMAFULL;
DEFINE FIELD started_at      ON _consolidator_runs TYPE datetime;
DEFINE FIELD completed_at    ON _consolidator_runs TYPE option<datetime>;
DEFINE FIELD chats_processed ON _consolidator_runs TYPE int DEFAULT 0;
DEFINE FIELD candidates_emitted ON _consolidator_runs TYPE int DEFAULT 0;
DEFINE FIELD trigger         ON _consolidator_runs TYPE string;  -- "cron" | "manual"
DEFINE FIELD notes           ON _consolidator_runs TYPE option<string>;

-- workflow.pending: candidate state
DEFINE FIELD pending         ON workflow TYPE bool DEFAULT false;
DEFINE FIELD deployed        ON workflow TYPE bool DEFAULT false;
DEFINE FIELD confidence      ON workflow TYPE float DEFAULT 0.5;
DEFINE FIELD render_service_url ON workflow TYPE option<string>;
DEFINE FIELD github_repo     ON workflow TYPE option<string>;

-- user_profile.api_keys: encrypted BYO keys
DEFINE FIELD api_keys        ON user_profile TYPE option<object>;
-- shape: { anthropic: <encrypted_string>, composio: <encrypted_string>, ... }
```

### 6.2 Multi-tenancy

Single namespace `microbots`, single database `app`. Every user-owned table gets:

- `owner: record<user_profile>` field
- `DEFINE TABLE ... PERMISSIONS FOR select, update, delete WHERE owner = $auth.id`

This is the v0 multi-tenancy model. Browser auth via `DEFINE ACCESS user TYPE RECORD` + short-lived JWTs (1h) minted by the FastAPI backend on login.

The `_playbook` namespace is separate but lives on the same SurrealDB server.

## 7. Component contracts

### 7.1 Agent loop (System 2)

```python
# scaffold/agent/loop.py — illustrative shape, not real impl

from pydantic_ai import Agent, RunContext
from pydantic import BaseModel

class AgentDeps(BaseModel):
    user_id: str
    surreal: SurrealClient
    composio_mcp_url: str
    anthropic_key: str

class AgentOutput(BaseModel):
    text: str | None = None
    html_card: str | None = None
    actions_taken: list[str]

agent = Agent[AgentDeps, AgentOutput](
    model='anthropic:claude-opus-4-7',  # via BYO key passed in deps
    deps_type=AgentDeps,
    output_type=AgentOutput,
    system_prompt=SKINNY_SYSTEM_PROMPT,  # ~300 tokens, indexes into read_layer
)

@agent.tool
async def read_layer(ctx: RunContext[AgentDeps], layer_id: str) -> str:
    """Read a memory layer by ID. See `layer_index` graph for the navigation tree."""
    ...

@agent.tool
async def traverse(ctx: RunContext[AgentDeps], from_id: str, edge: str, limit: int = 10) -> list[dict]:
    """Traverse one edge from a node."""
    ...

@agent.tool
async def search_hybrid(ctx: RunContext[AgentDeps], query: str, k: int = 10) -> list[dict]:
    """Hybrid FTS + vector + graph search."""
    ...

@agent.tool
async def write_memory(ctx: RunContext[AgentDeps], content: str, memory_type: str, about: str) -> str:
    """Persist a high-signal observation."""
    ...

@agent.tool
async def propose_workflow(ctx: RunContext[AgentDeps], name: str, description: str, trigger: str) -> str:
    """Propose a workflow candidate (pending=true)."""
    ...

# Composio tools auto-register via MCP
```

### 7.2 System prompt (skinny, indexes into navigation)

Borrowing R1's pattern from Agemo's Cody:

```
You are microbots, an opinionated assistant for {founder_name}.

Their world is in a graph. Don't try to remember it — read it on demand:
- Start at user:{user_id} for their profile
- Use read_layer(layer_id) to drill into integrations / entities / chats / memories / skills / workflows
- Use traverse(from_id, edge) for graph hops
- Use search_hybrid(query) when you don't know where to start

When you decide something matters, write_memory.
When you spot a repeating pattern, propose_workflow.

Composio tools are connected and ready. Use them naturally.

Output: either a one-liner text reply, or an html_card structured output for visual answers.
```

### 7.3 Heartbeat consolidator (System 1)

```python
# scaffold/agent/heartbeat.py — illustrative

async def run_heartbeat(user_id: str):
    last_run = await get_last_run_timestamp(user_id)
    new_chats = await fetch_chats_since(user_id, last_run)
    new_memories = await fetch_memories_since(user_id, last_run)
    
    clusters = cluster_via_hybrid_search(new_chats + new_memories)
    
    for cluster in clusters:
        if cluster.size >= 3 and cluster.repetition_score > 0.7:
            candidate = synthesize_workflow_candidate(cluster, llm=anthropic_raw)
            await write_workflow(user_id, candidate, pending=True)
    
    await record_run(user_id, processed=len(new_chats), emitted=len(clusters))
```

Wraps a ralph-loop-style retry/safety harness around it: max iterations, `<promise>DONE</promise>` sentinel for clean exit, state file in `_consolidator_runs`.

### 7.4 iframe UI contract

`scaffold/web/index.html` — vanilla HTML + SurrealDB JS SDK. On load:

1. Open WS to `wss://surrealdb-host/rpc`
2. Authenticate with JWT (passed from parent window via postMessage)
3. `db.use({ namespace: 'microbots', database: 'app' })`
4. `db.live(new Table('memory'))` → on push, upsert into D3/Cytoscape graph
5. `db.live(new Table('layer_index'))` → tree view sidebar
6. `db.live(new Table('workflow'))` → morning brief cards (filter `pending=true`)

Chat panel: SSE-consumes `/chat/stream` from FastAPI. SSE message types: `text`, `tool_call`, `html_card`.

### 7.5 Workflow primitive (PEP-723 server.py)

```python
# /// script
# requires-python = ">=3.11"
# dependencies = ["fastapi", "structlog", "composio"]
# [tool.env-checker]
# required = ["COMPOSIO_API_KEY", "USER_ID"]
# ///

from fastapi import FastAPI
from pydantic import BaseModel
import structlog

log = structlog.get_logger()
app = FastAPI()

class TriageRequest(BaseModel):
    correlation_id: str
    # ... workflow-specific fields

class TriageResponse(BaseModel):
    correlation_id: str
    actions_taken: list[str]

@app.post("/")
async def triage(req: TriageRequest) -> TriageResponse:
    log.info("triage_started", cid=req.correlation_id)
    # workflow logic here
    return TriageResponse(...)
```

This is the literal shape Devin scaffolds when promoting a candidate.

## 8. Auth and secrets

### 8.1 BYO API keys (per user)

On first signup:
1. Founder pastes Anthropic API key in onboarding form
2. FastAPI validates with a 1-token test message
3. On success: encrypt with app-level Fernet key (stored as Render secret), persist to `user_profile.api_keys.anthropic`
4. Repeat for Composio (or use Composio's per-user OAuth, which we do)
5. Show success → "Connect integrations" step

### 8.2 SurrealDB browser access

- Backend mints a JWT signed with SurrealDB record-access secret on each chat session start
- JWT contains `user_id` and `exp = now + 1h`
- Frontend passes JWT to iframe via postMessage
- Iframe `db.authenticate(jwt)` before opening live queries
- Renew token via `/auth/refresh` before expiry

### 8.3 What lives where

| Secret | Where | Notes |
|---|---|---|
| Anthropic API key | per-user, encrypted in `user_profile.api_keys` | founder pays |
| Composio Auth Configs | Composio dashboard | one per toolkit, app-level |
| Render API key | Render env var on agent service | for programmatic deploy |
| Devin API key | Render env var on agent service | for promotion |
| Logfire token | Render env var | observability |
| SurrealDB root creds | Render secret | for schema migrations only |
| SurrealDB record-access secret | Render env var | JWT signing |
| Mubit API key | Render env var | execution memory |
| Encryption key (Fernet) | Render secret | encrypts user-stored keys |

## 9. Observability — Logfire

Three lines in `main.py`:

```python
import logfire
logfire.configure(token=LOGFIRE_TOKEN, service_name='microbots')
logfire.instrument_pydantic_ai()
logfire.instrument_fastapi(app)
```

Auto-captures: every LLM call (prompt, response, tokens, cost), every tool call, validation retries, streaming chunk timing, FastAPI request/response. Custom spans for heartbeat consolidator runs:

```python
with logfire.span('heartbeat_run', user_id=user_id) as span:
    span.set_attribute('chats_processed', count)
    ...
```

For the demo: live Logfire dashboard URL pinned next to the chat UI. Sponsor visibility, real value.

## 10. Mubit integration

Mubit hooks at the LLM-client layer. We wrap pydantic-ai's underlying `AsyncAnthropic` instance:

```python
from anthropic import AsyncAnthropic
from mubit_anthropic import wrap as mubit_wrap

base_client = AsyncAnthropic(api_key=user_anthropic_key)
mubit_client = mubit_wrap(base_client, agent_id=f"microbots:{user_id}")
provider = AnthropicProvider(anthropic_client=mubit_client)
agent = Agent(model=AnthropicModel(provider=provider), ...)
```

Demo beat: side-by-side runs of the same task before/after a few uses, with Mubit's lessons-injected diff visible in the iframe.

## 11. Demo plan

See [skimple.md §"Demo narrative"](skimple.md). Five beats, ~3 minutes total.

### 11.1 Demo data prep

Before the demo:
- Pre-seed Demo-Founder's account with 7 days of synthetic Gmail + Slack data weighted to repeat the "Gmail → Linear copy" pattern 3-4 times
- Pre-train Mubit with 2-3 demo runs so the lessons are non-trivial
- Pre-record Devin happy path (3-min screen capture of an actual successful session)
- Pre-stage canned PR + GitHub repo as fallback
- Render Starter services warm

### 11.2 Failure mode contingencies

| Risk | Mitigation |
|---|---|
| Composio rate limit during demo | Pre-cache toolkit responses; fail-soft to "rate limited, continuing offline" |
| Devin live session hangs | Cut to recorded video at 30s timeout |
| Render deploy too slow | Show the API call success message; deploy completes off-camera |
| SurrealDB live query lag | Local Docker SurrealDB with WAN-failover to Cloud (or vice versa) |
| Anthropic API rate limit | Have backup test key ready |
| Wifi blip | Localhost demo via tunneled Render URLs |

## 12. Bench plan (Saturday)

Five founder-flavored tasks, each scored on success / time / quality vs Claude (raw) and Perplexity (raw):

| Task | What we score |
|---|---|
| "Find me the fastest route from A to B" | time (sec) |
| "Find me the latest blogs on X" | recency (avg date) |
| "Find me the cheapest flats in Y" | price (£) |
| "Find me the best flights from A to B" | combined (price × time × stops) |
| "Find me intel on person X" | research depth (num verified facts) |

Jordan has prior data showing CodeWords beats both on these. We replicate the harness with microbots and submit the report alongside the live demo.

## 13. Risks and open questions

### 13.1 Technical risks (P × I sized)

| Risk | P | I | Mitigation |
|---|---|---|---|
| Composio MCP integration with pydantic-ai has rough edges | M | M | R8 says zero-config; verify Friday morning with a smoke test |
| SurrealDB live queries lag under load | L | M | single-user demo load is trivial |
| Mubit alpha SDK incompatibility | M | L | optional sponsor; cut on Saturday if breaks |
| Devin session unreliability | H | M | hybrid demo (live + recorded) covers it |
| Render free-tier sleep cold-start | H | H | use Starter — already budgeted in SKIMPLE |
| Anthropic key rate limit during demo | L | H | backup key + caching |

### 13.2 Open product questions (logged for team review)

1. **Demo task lock** — defaulted to Gmail → Linear copy-paste cluster as the workflow promotion target. Confirm or swap.
2. **Devin live vs recorded only** — confirm we want hybrid (~2h setup) or recorded-only (~30 min, weaker signal)
3. **Surreal Cloud vs self-hosted on Render** — recommend Cloud for the demo (one less moving piece)
4. **IoA scope** — single seed founder ("Desmond") + Demo-Founder is enough to demo the reveal. Is a third user warranted?
5. **Bench harness owner** — Desmond suggested he'd take this Saturday morning while Jordan tunes. Confirm.

## 14. Out of scope (post-hackathon)

- Production auth (Auth0/Clerk)
- Multi-org with role-based permissions
- Real-time embedding generation pipeline (Hugging Face / Voyage AI / Cohere)
- Browser-agent fallback (separate `browser-use` agent node)
- Full Devin promotion in production (rate-limit-aware, retry, observability)
- agents.md auto-regeneration cadence
- Mobile / responsive UI
- White-label deploy for partners

## 15. References

- [skimple.md](skimple.md) — distilled top-of-mind
- [handoff.md](handoff.md) — decisions taken, files touched
- [progress.md](progress.md) — running activity log
- [research index](../README.md) — routing index for the deep-dive research files
- [knowledge_graph/schema/](../../../knowledge_graph/schema/) — SurrealQL schema (already committed)
- `agent/scaffold/` — agent loop interface contracts, iframe mock, render.yaml (stale path; scaffold no longer present in this workspace)
- WhatsApp thread: [`../raw/whatsapp.md`](../raw/whatsapp.md)
- BRAINDUMP: [`../raw/braindump.md`](../raw/braindump.md)

---

**Next step:** Read [plan-v1.md](plan-v1.md) for the bounded ordered task list.
