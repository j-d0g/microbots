# Microbots API Reference

*For the frontend developer.*

Everything you need to connect users to their tools (Slack/GitHub/Gmail/Linear/Notion/Perplexity) and read the knowledge graph back, over plain HTTP. No MCP knowledge required — that's covered separately in `docs/agent-harness-integration.md` for agent authors.

> **Companion docs**:
> - **Live Swagger UI**: https://app-bf31.onrender.com/docs (interactive request builder)
> - **OpenAPI spec**: https://app-bf31.onrender.com/openapi.json (machine-readable)
> - **Agent integration**: `docs/agent-harness-integration.md` (for MCP / pydantic-ai consumers)

---

## 1. Base URL and conventions

```
Base URL: https://app-bf31.onrender.com
Auth:     none (single-tenant for the hackathon)
CORS:     open (`Access-Control-Allow-Origin: *`) — browser fetches work without proxying
Encoding: JSON in, JSON out
```

| Convention | Detail |
|------------|--------|
| Method casing | `GET`, `POST` (no `PATCH`/`DELETE` in v1) |
| Body content type | `application/json` for POSTs |
| Response content type | `application/json` always |
| 4xx errors | Body shape: `{"detail": "human-readable message"}` |
| Time format | ISO-8601 strings with `+00:00` offset (UTC) |
| Cold-start latency | ~30 s on first request after 15 min idle (free Render tier) |

The fastest way to test it works right now:

```bash
curl https://app-bf31.onrender.com/api/health
```

Should return:

```json
{
  "status": "ok",
  "service": "microbots",
  "surreal":  {"ok": true, "table_count": 27},
  "composio": {"ok": true, "toolkit_count": 6}
}
```

---

## 2. Quick start — connect a user's Slack in 3 lines

```typescript
const BASE = "https://app-bf31.onrender.com";

const { redirect_url } = await fetch(`${BASE}/api/composio/connect`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    user_id: "user_42",
    toolkit: "slack",
    callback_url: "https://your-frontend.com/oauth/return",
  }),
}).then(r => r.json());

window.open(redirect_url, "_blank");   // user completes consent in popup
```

Then poll until status is `ACTIVE`:

```typescript
const { connections } = await fetch(
  `${BASE}/api/composio/connections?user_id=user_42`
).then(r => r.json());
// connections.find(c => c.toolkit === "slack")?.status === "ACTIVE"
```

That's the entire OAuth integration.

---

## 3. Endpoint reference — Composio OAuth

The three endpoints the frontend cares most about. All under `/api/composio/`.

### `GET /api/composio/toolkits`

List every toolkit the admin has enabled in the Composio dashboard. Use this to render the "Connect a tool" picker.

**Request**

```http
GET /api/composio/toolkits
```

**Response 200**

```json
{
  "toolkits": [
    { "slug": "slack",        "name": "Slack",        "auth_config_id": "ac_ygqlh4awT-tu" },
    { "slug": "github",       "name": "Github",       "auth_config_id": "ac_DjnG_CHfD8AY" },
    { "slug": "gmail",        "name": "Gmail",        "auth_config_id": "ac_JypA-BHt5D3y" },
    { "slug": "linear",       "name": "Linear",       "auth_config_id": "ac_PeaXWTdNYUYW" },
    { "slug": "notion",       "name": "Notion",       "auth_config_id": "ac_dWM9BZrvKgLp" },
    { "slug": "perplexityai", "name": "Perplexityai", "auth_config_id": "ac_PKxuysW0HmBf" }
  ]
}
```

The `auth_config_id` is informational — you don't need to send it back. Just use `slug` in `POST /connect`.

---

### `POST /api/composio/connect`

Initiate the Composio-hosted OAuth flow for one user + one toolkit.

**Request**

```http
POST /api/composio/connect
Content-Type: application/json

{
  "user_id":      "user_42",
  "toolkit":      "slack",
  "callback_url": "https://your-frontend.com/oauth/return"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `user_id` | string | yes | Your opaque user identifier — keep stable per user |
| `toolkit` | string | yes | One of the slugs from `GET /toolkits` |
| `callback_url` | string | yes | Where Composio will redirect the user *after* consent. Must be HTTPS in production; `http://localhost:*` is fine for local dev. |

**Response 200**

```json
{
  "redirect_url":  "https://accounts.composio.dev/oauth/authorize?...",
  "connection_id": "ca_abc123",
  "status":        "INITIATED"
}
```

Open `redirect_url` in a popup or new tab. Composio handles the full OAuth dance and redirects the user back to `callback_url` with query params:

```
?status=success&connected_account_id=ca_abc123&user_id=user_42
```

**Response 400** — toolkit is not enabled in the Composio dashboard

```json
{
  "detail": "Unknown toolkit 'discord'. Available: ['github','gmail','linear','notion','perplexityai','slack']"
}
```

**Response 502** — Composio API itself errored

```json
{
  "detail": "Composio error: HTTPStatusError: 401 Unauthorized"
}
```

---

### `GET /api/composio/connections?user_id={id}`

List the user's existing connections (any status).

**Request**

```http
GET /api/composio/connections?user_id=user_42
```

**Response 200**

```json
{
  "user_id": "user_42",
  "connections": [
    { "toolkit": "slack",  "status": "ACTIVE",    "id": "ca_abc" },
    { "toolkit": "github", "status": "INITIATED", "id": "ca_xyz" }
  ]
}
```

Use this to:
- **Poll after `/connect`** until `status === "ACTIVE"` — that's the moment the user finished consent
- **Render a "Connected apps" panel** showing which integrations are live

**Status values**: `INITIATED`, `ACTIVE`, `EXPIRED`, `FAILED`

---

## 4. Endpoint reference — Knowledge Graph (REST)

Every query the agents run is also exposed as a plain REST endpoint, so the frontend can render dashboards without touching MCP.

All paths under `/api/kg/`. All return JSON.

### `GET /api/kg/user`

Root user profile + aggregate counts. Call this on app load to populate the user header + dashboard counters.

**Response 200**

```json
{
  "id":            "user_profile:default",
  "name":          "Desmond",
  "role":          "AI engineer",
  "goals":         ["Build agent memory infrastructure", "..."],
  "preferences":   { "code_review": "thorough...", "deploy": "always notify..." },
  "context_window": 4000,
  "created_at":    "2026-04-25T20:03:00.277804+00:00",
  "updated_at":    "2026-04-25T20:03:00.277806+00:00",

  "chat_count":        49,
  "memory_count":      40,
  "entity_count":      28,
  "skill_count":       19,
  "workflow_count":    3,
  "integration_count": 6
}
```

---

### `GET /api/kg/integrations`

Every integration the user has connected, with co-usage edges.

**Response 200**

```json
[
  {
    "slug":        "github",
    "name":        "GitHub",
    "category":    "code",
    "frequency":   "daily",
    "description": "Code hosting, PR reviews, and CI/CD pipelines.",
    "user_purpose": "Code collaboration, PR reviews, and CI pipeline management.",
    "co_used_with_slugs": [
      { "out": { "slug": "linear" } },
      { "out": { "slug": "perplexity" } }
    ]
  }
]
```

---

### `GET /api/kg/integrations/{slug}?limit=10`

Deep info for one integration: entities, top memories, skills.

**Response 200**

```json
{
  "slug": "slack",
  "name": "Slack",
  "category": "communication",
  "...": "...",
  "entities":     [ /* entity rows */ ],
  "top_memories": [ /* memory rows ordered by confidence */ ],
  "skills":       [ /* skill rows that use this integration */ ]
}
```

**Response 404** — slug not found

---

### `GET /api/kg/memories?by={confidence|recency}&limit=20`

Top memories the system has learned about the user.

| Query param | Type | Default | Notes |
|-------------|------|---------|-------|
| `by` | `confidence` \| `recency` | `confidence` | sort order |
| `limit` | int | 20 | 1–200 |

**Response 200**

```json
[
  {
    "id":           "memory:abc",
    "content":      "Alice Chen is the go-to decision-maker for all infrastructure questions.",
    "memory_type":  "fact",
    "confidence":   0.98,
    "source":       "slack",
    "tags":         ["people", "infra"],
    "created_at":   "..."
  }
]
```

---

### `GET /api/kg/skills?min_strength=1`

Atomic repeatable behaviours the user has demonstrated.

| Query param | Type | Default | Notes |
|-------------|------|---------|-------|
| `min_strength` | int | 1 | filter to high-confidence skills only |

**Response 200**

```json
[
  {
    "id":           "skill:complete_implementation_task",
    "slug":         "complete_implementation_task",
    "name":         "Complete Implementation Task",
    "description":  "Marks a Linear ticket as 'Done' after completing an implementation task...",
    "frequency":    "weekly",
    "strength":     11,
    "tags":         ["linear", "github"],
    "integrations": ["linear", "github"]
  }
]
```

---

### `GET /api/kg/workflows`

Multi-step workflows that chain skills together.

**Response 200**

```json
[
  {
    "id":          "workflow:morning_brief",
    "slug":        "morning_brief",
    "name":        "Morning Brief",
    "description": "End-to-end morning briefing: gmail triage → slack summary",
    "trigger":     "daily 9am",
    "outcome":     "User has full context before standup",
    "skill_chain": [
      { "out": { "skill_slug": "fetch_inbox" }, "step_order": 1 },
      { "out": { "skill_slug": "summarise" },   "step_order": 2 }
    ]
  }
]
```

---

### `GET /api/kg/entities?entity_type={type}` and `GET /api/kg/entity-types`

`entity-types` returns the list of distinct types with counts:

```json
[
  { "entity_type": "person",       "count": 8 },
  { "entity_type": "organisation", "count": 5 },
  { "entity_type": "project",      "count": 6 }
]
```

`entities?entity_type=person` returns the entities of that type:

```json
[
  {
    "id":          "entity:martin",
    "name":        "Martin",
    "entity_type": "person",
    "aliases":     ["@martin"],
    "tags":        ["engineer"],
    "chat_mention_count": 7
  }
]
```

---

### `GET /api/kg/entities/{id}`

Full info for one entity, including the chats it's mentioned in.

**Response 200**

```json
{
  "id":          "entity:martin",
  "name":        "Martin",
  "entity_type": "person",
  "...":         "...",
  "appears_in_edges": [
    { "integration_slug": "slack",  "handle": "@martin", "role": "engineer" }
  ],
  "mentions": [
    { "chat_id": "chat:c01", "in.title": "demo prep", "in.source_type": "slack_thread", "mention_type": "author" }
  ]
}
```

---

### `GET /api/kg/chats/summary`

Chat counts grouped by integration + signal level. Useful for a dashboard widget.

**Response 200**

```json
[
  { "integration": "slack",  "signal_level": "high", "count": 8 },
  { "integration": "github", "signal_level": "high", "count": 6 },
  { "integration": "slack",  "signal_level": "low",  "count": 2 }
]
```

---

### `GET /api/kg/wiki` and `GET /api/kg/wiki/{path}`

The wiki is the agent-generated markdown layer. The tree endpoint returns paths only (cheap), the page endpoint returns content.

```http
GET /api/kg/wiki
```

```json
[
  { "path": "user.md",                         "depth": 1, "layer": "root" },
  { "path": "integrations/slack/agents.md",    "depth": 3, "layer": "slack" },
  { "path": "memories/agents.md",              "depth": 2, "layer": "memories" }
]
```

```http
GET /api/kg/wiki/user.md
```

```json
{
  "path":    "user.md",
  "content": "# About Desmond\n\nAI engineer at...\n## Goals\n- ...",
  "depth":   1,
  "layer":   "root"
}
```

URL-encode the path if it contains slashes — though the route handler accepts them too: `GET /api/kg/wiki/integrations/slack/agents.md` works.

---

## 4b. Knowledge Graph — Write endpoints

The same data the MCP tools serve, but also writable via plain REST. All
writes are **upsert / append** — there are no destructive deletes in v1.
Calling the same endpoint with the same identifier is safe (entity / skill /
workflow / wiki are keyed by slug or path; memory is keyed by content hash).

### `POST /api/kg/memories` — record a memory

```http
POST /api/kg/memories
Content-Type: application/json

{
  "content":                "User prefers small focused PRs.",
  "memory_type":            "preference",          // fact / preference / action_pattern / decision / observation
  "confidence":             0.85,                  // 0.0 – 1.0
  "source":                 "agent",               // optional, free-form
  "tags":                   ["code-review"],       // optional
  "chat_id":                "chat:abc",            // optional — also creates chat_yields edge
  "about_entity_id":        "entity:martin",       // optional — also creates memory_about edge
  "about_integration_slug": "github"               // optional — also creates memory_about edge
}

→ 201 { "id": "memory:agent_<hash>", "memory_id": "agent_<hash>" }
```

Idempotent on `content` — re-posting the same content updates the same row.

### `POST /api/kg/entities` — upsert a person / org / project

```http
POST /api/kg/entities
{
  "name":                   "Alice Chen",
  "entity_type":            "person",              // person / organisation / project / product / concept
  "description":            "Infra lead at Microbots",
  "aliases":                ["@alice", "alice-chen"],
  "tags":                   ["infra"],
  "appears_in_integration": "slack",               // optional — creates appears_in edge
  "appears_in_handle":      "@alice",              // optional
  "appears_in_role":        "infra"                // optional
}

→ 201 { "id": "entity:person_alice_chen", "slug": "person_alice_chen" }
```

Identity is `(entity_type, name)`. Re-posting with the same `(type, name)` merges aliases / tags / description.

### `POST /api/kg/skills` — add or strengthen a skill

```http
POST /api/kg/skills
{
  "slug":                "notify_deploy",
  "name":                "Notify #deployments before push",
  "description":         "Posts a heads-up message to #deployments before each prod deploy",
  "steps":               ["draft message", "post to #deployments", "wait for ack"],
  "frequency":           "daily",
  "strength_increment":  1,                        // added to existing strength on each call
  "tags":                ["slack", "deploy"],
  "uses_integrations":   ["slack"]                 // creates skill_uses edges
}

→ 201 { "id": "skill:notify_deploy", "slug": "notify_deploy", "strength": 5, "created": false }
```

Atomic — calling twice with `strength_increment: 2` and `strength_increment: 3` results in `strength = 5`.

### `POST /api/kg/workflows` — upsert a workflow

```http
POST /api/kg/workflows
{
  "slug":          "morning_brief",
  "name":          "Morning Brief",
  "description":   "Daily morning briefing assembling Slack + GitHub + Linear updates.",
  "trigger":       "daily 9am",
  "outcome":       "User has full context before standup",
  "frequency":     "daily",
  "tags":          ["briefing"],
  "skill_chain": [
    { "slug": "fetch_inbox",  "step_order": 1 },
    { "slug": "summarise",    "step_order": 2 },
    { "slug": "post_summary", "step_order": 3 }
  ]
}

→ 201 { "id": "workflow:morning_brief", "slug": "morning_brief" }
```

When `skill_chain` is provided, it **replaces** any existing chain. Pass `null` (or omit) to leave the chain untouched.

### `POST /api/kg/chats` — record an observation / chat

```http
POST /api/kg/chats
{
  "content":          "Alice: deployment-staging finished cleanly",
  "source_type":      "slack_thread",              // free-form; e.g. github_issue, agent_observation
  "source_id":        "slack-thread-abc123",       // dedup key — re-posting same id upserts
  "title":            "Staging deploy",
  "summary":          "Deployment to staging completed without errors.",
  "signal_level":     "high",                      // low / mid / high
  "occurred_at":      "2026-04-26T08:42:00Z",      // ISO-8601
  "from_integration": "slack",
  "mentions": [
    { "id": "entity:person_alice_chen", "mention_type": "author" }
  ]
}

→ 201 { "id": "chat:slack-thread-abc123" }
```

### `PUT /api/kg/wiki/{path}` — write a wiki page

```http
PUT /api/kg/wiki/memories/agents.md
{
  "content":   "# Memories\n\n- User prefers async-first comms\n- Notify #deployments before push",
  "rationale": "Refreshed after enrichment cycle"
}

→ 200 { "id": "wiki_page:memories_agents_md", "path": "memories/agents.md",
        "updated": true, "unchanged": false, "revision": 3 }
```

Path slashes work fine — URL-encoded or raw. The endpoint is idempotent: posting the same `content` twice returns `{updated: false, unchanged: true}` and does not log a new revision row. Each content change increments `revision` and writes a `wiki_page_revision` row for history.

**Allowed path prefixes** (schema constraint): `root` (i.e. `user.md`) · `integrations/...` · `entities/...` · `chats/...` · `memories/...` · `skills/...` · `workflows/...`. Any other prefix gets normalised to `root`.

### `PATCH /api/kg/user` — update the user profile

```http
PATCH /api/kg/user
{
  "name":           "Desmond",                 // optional
  "role":           "AI engineer",             // optional
  "goals":          [ "ship microbots v1" ],   // optional — replaces existing
  "preferences":    { "deploy": "thursdays" }, // optional — merges into existing
  "context_window": 8000                       // optional, 512–200000
}

→ 200 { "id": "user_profile:default", "updated": true,
        "fields": ["updated_at", "preferences"] }
```

Every field is optional. Only fields you pass are updated; the rest are left untouched.

---

## 5. System endpoints

### `GET /health`

Cheap probe. Returns 200 + `{"status":"ok","service":"microbots"}`. Use for warming up the free-tier instance before showing the UI.

### `GET /api/health`

Rich liveness — also reports Surreal + Composio sub-status.

```json
{
  "status": "ok",
  "service": "microbots",
  "surreal":  { "ok": true, "table_count": 27 },
  "composio": { "ok": true, "toolkit_count": 6 }
}
```

If `surreal.ok` or `composio.ok` is `false`, downstream is impaired but the API process itself is up. Render a "degraded mode" banner in the UI.

---

## 6. Common workflows — full code samples

### 6.1. Render the "Connect Apps" page

```typescript
const BASE = "https://app-bf31.onrender.com";

async function loadAvailableToolkits() {
  const r = await fetch(`${BASE}/api/composio/toolkits`);
  return (await r.json()).toolkits as Toolkit[];
}

async function loadUserConnections(userId: string) {
  const r = await fetch(`${BASE}/api/composio/connections?user_id=${userId}`);
  return (await r.json()).connections as Connection[];
}

// Render: for each toolkit, mark as connected if userConnections.find(c => c.toolkit === t.slug && c.status === "ACTIVE")
```

### 6.2. Connect a user to Slack with status polling

```typescript
async function connectToolkit(userId: string, toolkit: string) {
  // 1. Initiate
  const r = await fetch(`${BASE}/api/composio/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id:      userId,
      toolkit,
      callback_url: `${window.location.origin}/oauth/return`,
    }),
  });
  if (!r.ok) {
    const { detail } = await r.json();
    throw new Error(detail);
  }
  const { redirect_url } = await r.json();

  // 2. Open popup
  const popup = window.open(redirect_url, "composio-oauth", "width=600,height=700");

  // 3. Poll until ACTIVE (or popup closed)
  return new Promise<void>((resolve, reject) => {
    const interval = setInterval(async () => {
      const conns = await loadUserConnections(userId);
      const c = conns.find(x => x.toolkit === toolkit);
      if (c?.status === "ACTIVE") {
        clearInterval(interval);
        popup?.close();
        resolve();
      } else if (popup?.closed) {
        clearInterval(interval);
        reject(new Error("User closed the popup before completing consent"));
      }
    }, 2000);
  });
}

// Usage:
await connectToolkit("user_42", "slack");
```

### 6.3. Render the user's graph dashboard

```typescript
async function loadDashboard(userId: string) {
  const [user, integrations, memories, skills, workflows] = await Promise.all([
    fetch(`${BASE}/api/kg/user`).then(r => r.json()),
    fetch(`${BASE}/api/kg/integrations`).then(r => r.json()),
    fetch(`${BASE}/api/kg/memories?limit=10`).then(r => r.json()),
    fetch(`${BASE}/api/kg/skills?min_strength=2`).then(r => r.json()),
    fetch(`${BASE}/api/kg/workflows`).then(r => r.json()),
  ]);
  return { user, integrations, memories, skills, workflows };
}
```

### 6.4. Wake the cold-started service before showing the UI

```typescript
async function warmUp() {
  // Returns ~30s on cold start, ~150ms when warm.
  await fetch(`${BASE}/health`);
}

// In your app entrypoint:
warmUp().catch(() => {/* render skeleton anyway */});
```

---

## 7. TypeScript types (copy-paste)

```typescript
// ── Composio ─────────────────────────────────────────────────────────

export interface Toolkit {
  slug:           string;   // "slack" | "github" | "gmail" | "linear" | "notion" | "perplexityai"
  name:           string;
  auth_config_id: string;   // informational — frontend doesn't need to use this
}

export interface ToolkitsResponse {
  toolkits: Toolkit[];
}

export interface ConnectRequest {
  user_id:      string;
  toolkit:      string;
  callback_url: string;
}

export interface ConnectResponse {
  redirect_url:  string;
  connection_id: string;
  status:        "INITIATED";
}

export type ConnectionStatus = "INITIATED" | "ACTIVE" | "EXPIRED" | "FAILED";

export interface Connection {
  toolkit: string;
  status:  ConnectionStatus;
  id:      string;
}

export interface ConnectionsResponse {
  user_id:     string;
  connections: Connection[];
}

// ── Knowledge Graph ──────────────────────────────────────────────────

export interface UserProfile {
  id:                 string;
  name:               string;
  role:               string;
  goals:              string[];
  preferences:        Record<string, unknown>;
  context_window:     number;
  created_at:         string;
  updated_at:         string;
  chat_count:         number;
  memory_count:       number;
  entity_count:       number;
  skill_count:        number;
  workflow_count:     number;
  integration_count:  number;
}

export interface Integration {
  slug:               string;
  name:               string;
  category?:          string;
  frequency?:         string;
  description?:       string;
  user_purpose?:      string;
  co_used_with_slugs: { out: { slug: string } }[];
}

export interface Memory {
  id:           string;
  content:      string;
  memory_type:  string;
  confidence:   number;
  source?:      string;
  tags?:        string[];
  created_at:   string;
}

export interface Skill {
  id:           string;
  slug:         string;
  name:         string;
  description:  string;
  frequency?:   string;
  strength:     number;
  tags?:        string[];
  integrations: string[];
}

export interface Workflow {
  id:          string;
  slug:        string;
  name:        string;
  description: string;
  trigger?:    string;
  outcome?:    string;
  skill_chain: { out: { skill_slug: string }; step_order: number }[];
}

export interface Entity {
  id:                  string;
  name:                string;
  entity_type:         string;
  aliases?:            string[];
  tags?:               string[];
  chat_mention_count?: number;
}

export interface WikiPage {
  path:    string;
  content: string;
  depth:   number;
  layer:   string;
}

// ── Write request bodies ─────────────────────────────────────────────

export interface AddMemoryBody {
  content:                  string;
  memory_type?:             "fact" | "preference" | "action_pattern" | "decision" | "observation";
  confidence?:              number;          // 0.0 – 1.0, default 0.7
  source?:                  string;
  tags?:                    string[];
  chat_id?:                 string;
  about_entity_id?:         string;
  about_integration_slug?:  string;
}

export interface UpsertEntityBody {
  name:                     string;
  entity_type:              string;
  description?:             string;
  aliases?:                 string[];
  tags?:                    string[];
  appears_in_integration?:  string;
  appears_in_handle?:       string;
  appears_in_role?:         string;
}

export interface UpsertSkillBody {
  slug:                 string;
  name:                 string;
  description:          string;
  steps?:               string[];
  frequency?:           string;
  strength_increment?:  number;     // default 1, 1–10
  tags?:                string[];
  uses_integrations?:   string[];
}

export interface UpsertWorkflowBody {
  slug:         string;
  name:         string;
  description:  string;
  trigger?:     string;
  outcome?:     string;
  frequency?:   string;
  tags?:        string[];
  skill_chain?: { slug: string; step_order: number }[];
}

export interface AddChatBody {
  content:          string;
  source_type:      string;
  source_id?:       string;
  title?:           string;
  summary?:         string;
  signal_level?:    "low" | "mid" | "high";    // default "mid"
  occurred_at?:     string;                    // ISO-8601
  from_integration?: string;
  mentions?:        { id: string; mention_type?: string }[];
}

export interface WriteWikiPageBody {
  content:    string;
  rationale?: string;
}

export interface UpdateUserProfileBody {
  name?:            string;
  role?:            string;
  goals?:           string[];
  preferences?:     Record<string, unknown>;
  context_window?:  number;     // 512–200000
}

// ── Write responses ──────────────────────────────────────────────────

export interface AddMemoryResponse  { id: string; memory_id: string; }
export interface UpsertEntityResp   { id: string; slug: string; }
export interface UpsertSkillResp    { id: string; slug: string; strength: number; created: boolean; }
export interface UpsertWorkflowResp { id: string; slug: string; }
export interface AddChatResponse    { id: string; }
export interface WriteWikiResp      { id: string; path: string; updated: boolean; unchanged: boolean; revision: number; }
export interface UpdateUserResp     { id: string; updated: boolean; fields: string[]; }

// ── Errors ───────────────────────────────────────────────────────────

export interface ErrorResponse {
  detail: string;   // human-readable message
}
```

---

## 8. Error handling

Every error response has the same shape: `{"detail": "<human-readable message>"}`.

| HTTP code | When | Frontend should |
|-----------|------|-----------------|
| `400` | Invalid input (e.g. unknown toolkit slug, bad query param) | Show the `detail` to the user, fix the request |
| `404` | Resource not found (e.g. wiki page that doesn't exist) | Show "not found" or fall back to a default |
| `422` | Pydantic validation failed | Show field-level errors from the response |
| `502` | Downstream (Composio / SurrealDB) returned an error | Show "service temporarily unavailable", retry later |
| `5xx` | Our service is broken | Show generic error, log to your error reporter |

**Recommended error handler**:

```typescript
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      if (body?.detail) detail = body.detail;
    } catch {/* not JSON */}
    throw new Error(detail);
  }
  return r.json();
}
```

---

## 9. CORS, auth, and rate limits

| | Status |
|--|--|
| **CORS** | Open: `Access-Control-Allow-Origin: *`. Browser fetches just work. |
| **Auth** | None on the API itself. Single-tenant for the hackathon. Don't put real PII in the graph. |
| **OAuth tokens** | Stored at Composio, never on our backend. We never see raw `xoxb-…` etc. |
| **Rate limits** | None enforced by us. Composio's free tier is 20k tool calls / month (way more than enough). |
| **HTTPS** | Always. The base URL is HTTPS-only; HTTP requests get a 308 redirect. |
| **Cold starts** | Render free tier spins down after ~15 min idle. First request after sleep takes 30–60 s. Hit `/health` to wake. |

---

## 10. Caveats

1. **No callback handler on our side.** Composio redirects the user *directly* to your `callback_url` — we never see the redirect. Your frontend's callback page just needs to close the popup; the connection state is queried via `GET /connections`.

2. **Auto-discovered toolkits.** The list returned by `GET /toolkits` reflects the live Composio dashboard. If admin enables a 7th toolkit there, it'll appear in the next request — no backend redeploy needed.

3. **Free Render tier means cold starts.** Add a `/health` ping on app load to warm the instance before showing the UI.

4. **Refresh the graph** by re-running ingest from the backend — frontend reads what's there, doesn't write. Pipeline command: `python -m ingest --from-fixtures` (synthetic) or `python -m ingest` (real Composio data).

---

## 11. Quick Q&A

**Q: How do I know when a user finished OAuth?**
Poll `GET /connections?user_id=X` after `POST /connect`. When the matching toolkit's `status` flips to `"ACTIVE"`, you're done.

**Q: Can I list a different user's connections?**
Yes — there's no auth, but `user_id` is the namespace key. Pass any `user_id` in the query string.

**Q: What happens if a token expires?**
The connection's `status` becomes `"EXPIRED"`. Re-call `POST /connect` for that `(user_id, toolkit)` to re-initiate consent.

**Q: Can I add a custom toolkit (e.g. Discord)?**
Yes — admin enables it in the Composio dashboard, then `GET /toolkits` will include it automatically. No backend code change needed.

**Q: How do I cancel an in-flight OAuth?**
Just close the popup. The connection record stays in `INITIATED` state until expired (a few minutes) or until the user retries.

**Q: Where's the source code?**
- Composio routes: `app/routes/api_composio.py`
- KG REST routes: `app/routes/api_kg.py`
- Composio service wrapper: `app/services/composio.py`

**Q: Is there a websocket / SSE endpoint?**
Not yet. The MCP transport at `/mcp/` is SSE-based but that's for agent clients. For the frontend, polling `GET /connections` every 1–2 s during the OAuth window is the pattern.
