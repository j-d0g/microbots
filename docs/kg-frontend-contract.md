# KG ↔ Frontend Contract

What `web/` calls and what it gets back. Backed by `app/routes/api_kg.py` (REST) on top of `app/services/kg_writes.py` and `app/mcp/queries.py`.

---

## Base

- **Base URL**: `${NEXT_PUBLIC_KG_API_BASE}` (set in `web/.env.local`).
  - Local: `http://localhost:8001`
  - Deployed: `https://<app-service>.onrender.com` (TBD; will be added to `render.yaml`).
- **All paths are prefixed `/api/kg`**.
- **CORS**: open (`*`) per `app/main.py`. No auth headers required for the demo.
- **Content-type**: JSON in, JSON out.
- **Errors**: standard FastAPI shape — `{ "detail": string }` with HTTP 4xx/5xx.

### Suggested client

```ts
// web/lib/kg-client.ts (to write)
const BASE = process.env.NEXT_PUBLIC_KG_API_BASE!;
async function kg<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/kg${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json() as Promise<T>;
}
```

---

## Types

IDs are SurrealDB record strings — `"entity:martin"`, `"memory:agent_<hash>"`, etc. Treat as opaque.

```ts
type RecordId = string;       // "table:id"
type ISO8601  = string;       // "2026-04-26T09:08:00Z"
type Slug     = string;       // lowercased, snake_case

interface Integration {
  slug: Slug;                 // "slack" | "linear" | "notion" | "github" | "gmail"
  name: string;
  category?: string;
  frequency?: string;
  description?: string;
  user_purpose?: string;
  co_used_with_slugs: Slug[];
}

interface IntegrationDetail extends Integration {
  entities: Entity[];
  top_memories: Memory[];
  skills: Skill[];
}

interface EntityType { entity_type: string; count: number; }

interface Entity {
  id: RecordId;
  entity_type: string;        // "person" | "team" | "project" | "doc" | ...
  name: string;
  description?: string;
  aliases: string[];
  tags: string[];
  chat_mention_count: number;
}

interface EntityDetail extends Entity {
  appears_in_edges: { integration_slug: Slug; handle?: string; role?: string }[];
  mentions: { chat_id: RecordId; title?: string; source_type: string; mention_type: string }[];
}

interface Memory {
  id: RecordId;
  content: string;
  memory_type: "fact" | "preference" | "observation" | string;
  confidence: number;         // 0..1
  source?: string;
  tags: string[];
  updated_at?: ISO8601;
}

interface Skill {
  id: RecordId;
  slug: Slug;
  name: string;
  description: string;
  steps: string[];
  frequency?: string;
  strength: number;           // monotonically increasing usage counter
  tags: string[];
  integrations: Slug[];
}

interface Workflow {
  id: RecordId;
  slug: Slug;
  name: string;
  description: string;
  trigger?: string;
  outcome?: string;
  frequency?: string;
  tags: string[];
  skill_chain: { skill_slug: Slug; step_order: number }[];
}

interface ChatSummaryRow {
  integration: Slug;
  signal_level: "low" | "mid" | "high";
  count: number;
}

interface UserProfile {
  id: RecordId;               // "user_profile:default"
  name?: string;
  role?: string;
  goals: string[];
  preferences: Record<string, unknown>;
  context_window?: number;
  // Aggregates rolled up by Q_USER_PROFILE:
  chat_count: number;
  memory_count: number;
  skill_count: number;
  workflow_count: number;
  entity_count: number;
  integration_count: number;
}

interface WikiNode { path: string; depth: 1 | 2 | 3; layer: WikiLayer; }
interface WikiPage extends WikiNode { content: string; }
type WikiLayer =
  | "root" | "integrations" | "entities"
  | "chats" | "memories" | "skills" | "workflows";
```

---

## Read endpoints

| Method | Path | Query | Returns | Notes |
|---|---|---|---|---|
| GET | `/integrations` | — | `Integration[]` | All integrations, alphabetical |
| GET | `/integrations/{slug}` | — | `IntegrationDetail` | 404 if slug unknown |
| GET | `/entity-types` | — | `EntityType[]` | Sorted by count desc |
| GET | `/entities` | `entity_type` (req) | `Entity[]` | Filter by type |
| GET | `/entities/{id}` | — | `EntityDetail` | `id` = full record id, e.g. `entity:martin` |
| GET | `/memories` | `by=confidence\|recency` (default `confidence`), `limit=1..200` (default 20) | `Memory[]` | |
| GET | `/skills` | `min_strength=1..10` (default 1) | `Skill[]` | Sorted strength desc |
| GET | `/workflows` | — | `Workflow[]` | Includes skill_chain |
| GET | `/chats/summary` | — | `ChatSummaryRow[]` | Group-by integration × signal_level |
| GET | `/user` | — | `UserProfile` | Singleton `user_profile:default` |
| GET | `/wiki` | — | `WikiNode[]` | Path tree, no content |
| GET | `/wiki/{path}` | — | `WikiPage` | Path is multi-segment, e.g. `entities/martin` |

### Sample response — `GET /api/kg/memories?by=confidence&limit=3`

```json
[
  {
    "id": "memory:agent_e3a8…",
    "content": "Martin prefers async standups in Slack #standup-engineering.",
    "memory_type": "preference",
    "confidence": 0.92,
    "source": "slack",
    "tags": ["preference", "standup"],
    "updated_at": "2026-04-26T08:14:11Z"
  }
]
```

### Sample response — `GET /api/kg/integrations/slack`

```json
{
  "slug": "slack",
  "name": "Slack",
  "category": "comms",
  "co_used_with_slugs": ["linear", "github"],
  "entities": [ /* Entity[] */ ],
  "top_memories": [ /* Memory[] */ ],
  "skills": [ /* Skill[] */ ]
}
```

---

## Write endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/memories` | `AddMemoryBody` | `{ id: RecordId, memory_id: string }` |
| POST | `/entities` | `UpsertEntityBody` | `{ id: RecordId, slug: Slug }` |
| POST | `/skills` | `UpsertSkillBody` | `{ id, slug, strength, created }` |
| POST | `/workflows` | `UpsertWorkflowBody` | `{ id, slug }` |
| POST | `/chats` | `AddChatBody` | `{ id: RecordId }` |
| PUT  | `/wiki/{path}` | `WriteWikiPageBody` | `{ id, path, updated, unchanged, revision }` |
| PATCH | `/user` | `UpdateUserProfileBody` | `{ id, updated, fields }` |

```ts
interface AddMemoryBody {
  content: string;            // required, non-empty
  memory_type?: string;       // default "fact"
  confidence?: number;        // 0..1, default 0.7
  source?: string;
  tags?: string[];
  chat_id?: RecordId;         // edge: chat_yields → memory
  about_entity_id?: RecordId; // edge: memory → memory_about → entity
  about_integration_slug?: Slug;
}

interface UpsertEntityBody {
  name: string;               // required
  entity_type: string;        // required
  description?: string;
  aliases?: string[];
  tags?: string[];
  appears_in_integration?: Slug;
  appears_in_handle?: string;
  appears_in_role?: string;
}

interface UpsertSkillBody {
  slug: Slug;                 // required
  name: string;               // required
  description: string;        // required
  steps?: string[];
  frequency?: string;
  strength_increment?: number; // 1..10, default 1 (added to existing)
  tags?: string[];
  uses_integrations?: Slug[];
}

interface WorkflowSkillStep { slug: Slug; step_order: number; }
interface UpsertWorkflowBody {
  slug: Slug;                 // required
  name: string;               // required
  description: string;        // required
  trigger?: string;
  outcome?: string;
  frequency?: string;
  tags?: string[];
  skill_chain?: WorkflowSkillStep[]; // replaces existing chain when provided
}

interface AddChatMention { id: RecordId; mention_type?: string; }
interface AddChatBody {
  content: string;            // required
  source_type: string;        // required, e.g. "slack_message" | "agent_chat"
  source_id?: string;         // dedup key when present
  title?: string;
  summary?: string;
  signal_level?: "low" | "mid" | "high"; // default "mid"
  occurred_at?: ISO8601;
  from_integration?: Slug;
  mentions?: AddChatMention[];
}

interface WriteWikiPageBody {
  content: string;
  rationale?: string;
}

interface UpdateUserProfileBody {
  name?: string;
  role?: string;
  goals?: string[];
  preferences?: Record<string, unknown>;
  context_window?: number;    // 512..200000
}
```

### Idempotency

- `POST /memories` — id is `sha256(content)`; same content collapses to one row.
- `POST /entities` — id is `${entity_type}_${slug(name)}`; merges on repeat.
- `POST /skills` — id is `${slug}`; `strength` is **incremented by** `strength_increment` on each call.
- `POST /workflows` — id is `${slug}`; provided `skill_chain` **replaces** existing.
- `POST /chats` — id is `source_id` if given else `sha256(content + source_type)`.
- `PUT /wiki/{path}` — no-op when content unchanged; otherwise increments `revision` and logs a `wiki_page_revision`.

---

## Health

- `GET /health` (top-level, not under `/api/kg`) — cheap liveness, returns 200.
- `GET /api/health` — surreal + composio sub-status; useful for debug pages.

---

## Frontend integration points (suggested)

| UI surface | Endpoint(s) |
|---|---|
| Force graph nodes | `/integrations`, `/entities?entity_type=…`, `/entity-types` |
| Memory popups | `/memories?by=recency&limit=5` |
| Entity drawer | `/entities/{id}` |
| Wiki sidebar | `/wiki` for tree, `/wiki/{path}` on click |
| Skills strip / workflow cards | `/skills`, `/workflows` |
| Profile / stats header | `/user` |
| Persist new chat from agent stream | `POST /chats` |
| Persist composed workflow | `POST /workflows` |

---

## Open items

- `NEXT_PUBLIC_KG_API_BASE` value once `app/` is added to `render.yaml`.
- Whether the agent stream itself (the `/agent/stream` SSE) lives on the same origin as `/api/kg` — leaning yes, simpler CORS + same env var.
- Pagination: none of the read endpoints paginate today. If a list grows past ~200 rows we'll add cursors.
