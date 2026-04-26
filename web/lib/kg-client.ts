/**
 * KG ↔ Frontend contract client.
 *
 * Schema-exact TypeScript types + thin typed wrappers around every
 * endpoint in `/api/kg`. Types are authoritative here and re-imported
 * by windows + hooks so the UI surface stays in lockstep with the
 * backend Pydantic models (`app/routes/api_kg.py`).
 *
 * Design notes:
 *   - Base URL resolves in this order:
 *       1. `NEXT_PUBLIC_KG_API_BASE`    (preferred, per schema doc)
 *       2. `NEXT_PUBLIC_MICROBOTS_BASE_URL`  (existing unified origin)
 *       3. `""` (same-origin fetch)
 *     The fallback order lets existing deployments keep working with
 *     the old env var while new ones opt into the split.
 *   - `X-User-Id` is attached when the caller supplies a userId — the
 *     KG endpoints are single-tenant today but the header is
 *     forward-compat the day namespacing goes live.
 *   - Errors reuse `BackendError` from `lib/api/backend.ts` so UI
 *     code that already inspects `error.detail` / `error.status`
 *     keeps working across the two clients.
 *   - NO runtime schema validation. Types are assertions, trusted per
 *     the contract. If the server drifts, add a zod layer here.
 */

import { BackendError } from "./api/backend";

/* ============================== base ============================== */

const DEFAULT_BASE = "https://app-bf31.onrender.com";

/** Resolved at module load. SSR-safe. */
export const KG_BASE_URL: string =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_KG_API_BASE ||
      process.env.NEXT_PUBLIC_MICROBOTS_BASE_URL)) ||
  DEFAULT_BASE;

/* ============================== types ============================= */

/** Record id as returned by SurrealDB — `"table:id"`. Treat as opaque. */
export type RecordId = string;
/** Slug — lowercased snake_case. */
export type Slug = string;
/** ISO-8601 timestamp string. */
export type ISO8601 = string;

export interface Integration {
  slug: Slug;
  name: string;
  category?: string;
  frequency?: string;
  description?: string;
  user_purpose?: string;
  co_used_with_slugs: Slug[];
}

export interface IntegrationDetail extends Integration {
  entities: Entity[];
  top_memories: Memory[];
  skills: Skill[];
}

export interface EntityTypeCount {
  entity_type: string;
  count: number;
}

export interface Entity {
  id: RecordId;
  entity_type: string;
  name: string;
  description?: string;
  aliases: string[];
  tags: string[];
  chat_mention_count: number;
}

export interface EntityDetail extends Entity {
  appears_in_edges: {
    integration_slug: Slug;
    handle?: string;
    role?: string;
  }[];
  mentions: {
    chat_id: RecordId;
    title?: string;
    source_type: string;
    mention_type: string;
  }[];
}

export interface Memory {
  id: RecordId;
  content: string;
  memory_type: "fact" | "preference" | "observation" | string;
  confidence: number;
  source?: string;
  tags: string[];
  updated_at?: ISO8601;
}

export interface Skill {
  id: RecordId;
  slug: Slug;
  name: string;
  description: string;
  steps: string[];
  frequency?: string;
  strength: number;
  tags: string[];
  integrations: Slug[];
}

export interface WorkflowSkillStep {
  skill_slug: Slug;
  step_order: number;
}

export interface Workflow {
  id: RecordId;
  slug: Slug;
  name: string;
  description: string;
  trigger?: string;
  outcome?: string;
  frequency?: string;
  tags: string[];
  skill_chain: WorkflowSkillStep[];
}

export interface ChatSummaryRow {
  integration: Slug;
  signal_level: "low" | "mid" | "high";
  count: number;
}

export interface UserProfile {
  id: RecordId;
  name?: string;
  role?: string;
  goals: string[];
  preferences: Record<string, unknown>;
  context_window?: number;
  chat_count: number;
  memory_count: number;
  skill_count: number;
  workflow_count: number;
  entity_count: number;
  integration_count: number;
}

export type WikiLayer =
  | "root"
  | "integrations"
  | "entities"
  | "chats"
  | "memories"
  | "skills"
  | "workflows";

export interface WikiNode {
  path: string;
  depth: 1 | 2 | 3;
  layer: WikiLayer;
}

export interface WikiPage extends WikiNode {
  content: string;
}

/* ============================== writes ============================ */

export interface AddMemoryBody {
  content: string;
  memory_type?: string;
  confidence?: number;
  source?: string;
  tags?: string[];
  chat_id?: RecordId;
  about_entity_id?: RecordId;
  about_integration_slug?: Slug;
}

export interface UpsertEntityBody {
  name: string;
  entity_type: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  appears_in_integration?: Slug;
  appears_in_handle?: string;
  appears_in_role?: string;
}

export interface UpsertSkillBody {
  slug: Slug;
  name: string;
  description: string;
  steps?: string[];
  frequency?: string;
  strength_increment?: number;
  tags?: string[];
  uses_integrations?: Slug[];
}

export interface UpsertWorkflowBody {
  slug: Slug;
  name: string;
  description: string;
  trigger?: string;
  outcome?: string;
  frequency?: string;
  tags?: string[];
  skill_chain?: { slug: Slug; step_order: number }[];
}

export interface AddChatMention {
  id: RecordId;
  mention_type?: string;
}

export interface AddChatBody {
  content: string;
  source_type: string;
  source_id?: string;
  title?: string;
  summary?: string;
  signal_level?: "low" | "mid" | "high";
  occurred_at?: ISO8601;
  from_integration?: Slug;
  mentions?: AddChatMention[];
}

export interface WriteWikiPageBody {
  content: string;
  rationale?: string;
}

export interface UpdateUserProfileBody {
  name?: string;
  role?: string;
  goals?: string[];
  preferences?: Record<string, unknown>;
  context_window?: number;
}

/* ============================== client ============================ */

interface KgOpts extends Omit<RequestInit, "body"> {
  body?: unknown;
  userId?: string | null;
  baseUrl?: string;
  signal?: AbortSignal;
}

async function kg<T>(path: string, opts: KgOpts = {}): Promise<T> {
  const { body, userId, baseUrl, headers, signal, ...rest } = opts;
  const finalBase = baseUrl ?? KG_BASE_URL;
  const url = `${finalBase}/api/kg${path}`;

  const finalHeaders: Record<string, string> = {
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...((headers as Record<string, string> | undefined) ?? {}),
  };
  if (userId) finalHeaders["X-User-Id"] = userId;

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      signal,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new BackendError(
      err instanceof Error ? err.message : "network error",
      0,
    );
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* not JSON — keep default */
    }
    throw new BackendError(detail, res.status);
  }

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/* ============================== reads ============================= */

export function getIntegrations(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Integration[]> {
  return kg<Integration[]>("/integrations", { userId, signal });
}

export function getIntegration(
  slug: string,
  userId?: string | null,
  signal?: AbortSignal,
): Promise<IntegrationDetail> {
  return kg<IntegrationDetail>(`/integrations/${encodeURIComponent(slug)}`, {
    userId,
    signal,
  });
}

export function getEntityTypes(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<EntityTypeCount[]> {
  return kg<EntityTypeCount[]>("/entity-types", { userId, signal });
}

export function getEntities(
  entityType: string,
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Entity[]> {
  return kg<Entity[]>(
    `/entities?entity_type=${encodeURIComponent(entityType)}`,
    { userId, signal },
  );
}

export function getEntity(
  id: RecordId,
  userId?: string | null,
  signal?: AbortSignal,
): Promise<EntityDetail> {
  return kg<EntityDetail>(`/entities/${encodeURIComponent(id)}`, {
    userId,
    signal,
  });
}

export interface GetMemoriesOpts {
  by?: "confidence" | "recency";
  limit?: number;
}

export function getMemories(
  opts: GetMemoriesOpts = {},
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Memory[]> {
  const by = opts.by ?? "confidence";
  const limit = opts.limit ?? 20;
  return kg<Memory[]>(`/memories?by=${by}&limit=${limit}`, { userId, signal });
}

export function getSkills(
  opts: { minStrength?: number } = {},
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Skill[]> {
  const min = opts.minStrength ?? 1;
  return kg<Skill[]>(`/skills?min_strength=${min}`, { userId, signal });
}

export function getWorkflows(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Workflow[]> {
  return kg<Workflow[]>("/workflows", { userId, signal });
}

export function getChatsSummary(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<ChatSummaryRow[]> {
  return kg<ChatSummaryRow[]>("/chats/summary", { userId, signal });
}

export function getUser(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<UserProfile> {
  return kg<UserProfile>("/user", { userId, signal });
}

export function getWiki(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<WikiNode[]> {
  return kg<WikiNode[]>("/wiki", { userId, signal });
}

export function getWikiPage(
  path: string,
  userId?: string | null,
  signal?: AbortSignal,
): Promise<WikiPage> {
  // path may be multi-segment, e.g. "entities/martin" — keep slashes,
  // encode each segment.
  const encoded = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return kg<WikiPage>(`/wiki/${encoded}`, { userId, signal });
}

/* ============================== writes ============================ */

export function addMemory(
  body: AddMemoryBody,
  userId?: string | null,
): Promise<{ id: RecordId; memory_id: string }> {
  return kg("/memories", { method: "POST", body, userId });
}

export function upsertEntity(
  body: UpsertEntityBody,
  userId?: string | null,
): Promise<{ id: RecordId; slug: Slug }> {
  return kg("/entities", { method: "POST", body, userId });
}

export function upsertSkill(
  body: UpsertSkillBody,
  userId?: string | null,
): Promise<{ id: RecordId; slug: Slug; strength: number; created: boolean }> {
  return kg("/skills", { method: "POST", body, userId });
}

export function upsertWorkflow(
  body: UpsertWorkflowBody,
  userId?: string | null,
): Promise<{ id: RecordId; slug: Slug }> {
  return kg("/workflows", { method: "POST", body, userId });
}

export function addChat(
  body: AddChatBody,
  userId?: string | null,
): Promise<{ id: RecordId }> {
  return kg("/chats", { method: "POST", body, userId });
}

export function writeWikiPage(
  path: string,
  body: WriteWikiPageBody,
  userId?: string | null,
): Promise<{
  id: RecordId;
  path: string;
  updated: boolean;
  unchanged: boolean;
  revision: number;
}> {
  const encoded = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return kg(`/wiki/${encoded}`, { method: "PUT", body, userId });
}

export function updateUser(
  body: UpdateUserProfileBody,
  userId?: string | null,
): Promise<{ id: RecordId; updated: boolean; fields: string[] }> {
  return kg("/user", { method: "PATCH", body, userId });
}

/* ============================ re-exports ========================== */

export { BackendError };
