/**
 * Microbots backend client.
 *
 * One file, no extra deps. Wraps the live unified service exposing
 * Composio OAuth + the SurrealDB-backed knowledge graph.
 *
 * Conventions:
 *   - Base URL defaults to the local Python API, overridable
 *     via `NEXT_PUBLIC_MICROBOTS_BASE_URL`.
 *   - Every request injects `X-User-Id` if the caller has set one. KG
 *     read endpoints currently ignore this (single-tenant for the
 *     hackathon), but Composio routes require it as the namespace key
 *     and the header is forward-compatible the day KG goes per-user.
 *   - 4xx/5xx bodies use `{ detail: string }` or `{ error: string }`;
 *     we surface the message as a typed `BackendError`.
 *
 * Doc reference: docs/api-reference.md.
 */

const DEFAULT_BASE = "http://localhost:8001";

/** Resolved at module load. SSR-safe — falls back to the default. */
export const BASE_URL: string =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_KG_API_BASE ||
      process.env.NEXT_PUBLIC_MICROBOTS_BASE_URL)) ||
  DEFAULT_BASE;

/** Toolkit slugs the live Composio account has enabled. The list is
 *  authoritative on the backend; this enum is only used for UI
 *  ordering + agent prompt copy. Order matches the OAuth-discovered
 *  list. */
export const TOOLKIT_SLUGS = [
  "slack",
  "github",
  "gmail",
  "linear",
  "notion",
  "perplexityai",
] as const;
export type ToolkitSlug = (typeof TOOLKIT_SLUGS)[number];

/* ============================== types ============================= */

export interface UserProfile {
  id: string;
  name: string;
  role: string;
  goals: string[];
  preferences: Record<string, unknown>;
  context_window: number;
  created_at: string;
  updated_at: string;
  chat_count: number;
  memory_count: number;
  entity_count: number;
  skill_count: number;
  workflow_count: number;
  integration_count: number;
}

export type ConnectionStatus =
  | "INITIATED"
  | "ACTIVE"
  | "EXPIRED"
  | "FAILED";

export interface InputField {
  name: string;
  display_name: string;
  description: string;
  type: string;
  required: boolean;
}

export interface Toolkit {
  slug: string;
  name: string;
  auth_config_id: string;
  auth_scheme: string; // "OAUTH2" | "API_KEY" | …
  expected_input_fields: InputField[];
}

export interface Connection {
  toolkit: string;
  status: ConnectionStatus;
  id: string;
}

export interface ConnectResponse {
  redirect_url: string;
  connection_id: string;
  status: string; // "INITIATED" | "ACTIVE"
}

export interface IntegrationSummary {
  slug: string;
  name: string;
  category?: string;
  frequency?: string;
  description?: string;
  user_purpose?: string;
  co_used_with_slugs?: { out: { slug: string }; frequency?: number }[];
}

export interface IntegrationDetail extends IntegrationSummary {
  entities?: Array<{ id: string; name: string; entity_type?: string }>;
  top_memories?: Memory[];
  skills?: Skill[];
}

export type RecordId = string;
export type Slug = string;
export type ISO8601 = string;
export type Integration = IntegrationSummary;

export interface Memory {
  id: string;
  content: string;
  memory_type: string;
  confidence: number;
  source?: string;
  integration_slugs?: string[];
  tags?: string[];
  created_at?: string;
  updated_at?: ISO8601;
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  frequency?: string;
  strength: number;
  steps: string[];
  tags?: string[];
  integrations: string[];
}

export interface Entity extends EntityRow {
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

export interface WorkflowSkillStep {
  skill_slug: Slug;
  step_order: number;
}

export interface Workflow {
  id: string;
  slug: string;
  name: string;
  description: string;
  trigger?: string;
  outcome?: string;
  frequency?: string;
  tags: string[];
  skill_chain: WorkflowSkillStep[];
}

export interface EntityRow {
  id: string;
  name: string;
  entity_type: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  chat_mention_count?: number;
  integration_slugs?: string[];
}

export interface EntityTypeCount {
  entity_type: string;
  count: number;
}

export interface HealthResponse {
  status: string;
  service: string;
  surreal: { ok: boolean; table_count?: number };
  composio: {
    ok: boolean;
    configured: boolean;
    toolkit_count?: number;
    error?: string;
  };
}

/* ============================== errors ============================ */

export class BackendError extends Error {
  constructor(
    public detail: string,
    public status: number,
  ) {
    super(detail);
    this.name = "BackendError";
  }
}

/* ============================== client ============================ */

interface ApiOpts extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Override for the X-User-Id header. Defaults to the caller-provided
   *  argument on the public functions below. */
  userId?: string | null;
  /** Override the base URL. Used by tests. */
  baseUrl?: string;
}

async function api<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const { body, userId, baseUrl, headers, ...rest } = opts;
  const finalBase = baseUrl ?? BASE_URL;
  const finalUrl = `${finalBase}${path}`;

  const finalHeaders: Record<string, string> = {
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...((headers as Record<string, string> | undefined) ?? {}),
  };
  if (userId) finalHeaders["X-User-Id"] = userId;

  let res: Response;
  try {
    res = await fetch(finalUrl, {
      ...rest,
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
      const j = (await res.json()) as { detail?: unknown; error?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
      else if (typeof j.error === "string") detail = j.error;
    } catch {
      /* not JSON — keep default */
    }
    throw new BackendError(detail, res.status);
  }

  // 204 / empty body guard
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/* ============================== Composio ========================== */

export async function getToolkits(): Promise<Toolkit[]> {
  const r = await api<{ toolkits: Toolkit[] }>("/api/composio/toolkits");
  return r.toolkits ?? [];
}

export async function connectToolkit(
  userId: string,
  toolkit: string,
  callbackUrl: string,
): Promise<ConnectResponse> {
  return api<ConnectResponse>("/api/composio/connect", {
    method: "POST",
    userId,
    body: { user_id: userId, toolkit, callback_url: callbackUrl },
  });
}

export async function connectToolkitKey(
  userId: string,
  toolkit: string,
  fieldValues: Record<string, string>,
): Promise<ConnectResponse> {
  return api<ConnectResponse>("/api/composio/connect-key", {
    method: "POST",
    userId,
    body: { user_id: userId, toolkit, field_values: fieldValues },
  });
}

export async function getConnections(userId: string): Promise<Connection[]> {
  const r = await api<{ user_id: string; connections: Connection[] }>(
    `/api/composio/connections?user_id=${encodeURIComponent(userId)}`,
    { userId },
  );
  return r.connections ?? [];
}

/* ============================== KG reads ========================== */

export function getKgUser(userId?: string | null): Promise<UserProfile> {
  return api<UserProfile>("/api/kg/user", { userId });
}

export function getKgIntegrations(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<IntegrationSummary[]> {
  return api<IntegrationSummary[]>("/api/kg/integrations", { userId, signal });
}

export function getKgIntegration(
  slug: string,
  userId?: string | null,
  limit = 10,
  signal?: AbortSignal,
): Promise<IntegrationDetail> {
  return api<IntegrationDetail>(
    `/api/kg/integrations/${encodeURIComponent(slug)}?limit=${limit}`,
    { userId, signal },
  );
}

export const getIntegrations = getKgIntegrations;
export const getIntegration = getKgIntegration;

export function getKgMemories(
  opts: GetMemoriesOpts = {},
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Memory[]> {
  const by = opts.by ?? "confidence";
  const limit = opts.limit ?? 20;
  return api<Memory[]>(
    `/api/kg/memories?by=${by}&limit=${limit}`,
    { userId, signal },
  );
}

export type GetMemoriesOpts = { by?: "confidence" | "recency"; limit?: number };
export const getMemories = getKgMemories;

export function getKgSkills(
  opts: { minStrength?: number } = {},
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Skill[]> {
  const min = opts.minStrength ?? 1;
  return api<Skill[]>(`/api/kg/skills?min_strength=${min}`, { userId, signal });
}

export const getSkills = getKgSkills;

export function getKgWorkflows(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Workflow[]> {
  return api<Workflow[]>("/api/kg/workflows", { userId, signal });
}

export const getWorkflows = getKgWorkflows;

export function getKgEntityTypes(
  userId?: string | null,
  signal?: AbortSignal,
): Promise<EntityTypeCount[]> {
  return api<EntityTypeCount[]>("/api/kg/entity-types", { userId, signal });
}

export const getEntityTypes = getKgEntityTypes;

export function getKgEntities(
  entityType?: string,
  userId?: string | null,
  signal?: AbortSignal,
): Promise<EntityRow[]> {
  const q = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : "";
  return api<EntityRow[]>(`/api/kg/entities${q}`, { userId, signal });
}

export function getEntities(
  entityType?: string,
  userId?: string | null,
  signal?: AbortSignal,
): Promise<Entity[]> {
  const q = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : "";
  return api<Entity[]>(`/api/kg/entities${q}`, { userId, signal });
}

export function getEntity(
  id: RecordId,
  userId?: string | null,
  signal?: AbortSignal,
): Promise<EntityDetail> {
  return api<EntityDetail>(`/api/kg/entities/${encodeURIComponent(id)}`, {
    userId,
    signal,
  });
}

/* ============================== KG writes ========================= */
/* KG write helpers — used by kg-write-tools.ts and window tools. */

export interface AddMemoryBody {
  content: string;
  memory_type?:
    | "fact"
    | "preference"
    | "action_pattern"
    | "decision"
    | "observation";
  confidence?: number;
  source?: string;
  tags?: string[];
  chat_id?: string;
  about_entity_id?: string;
  about_integration_slug?: string;
}

export function addMemory(
  body: AddMemoryBody,
  userId?: string | null,
): Promise<{ id: string; memory_id: string }> {
  return api("/api/kg/memories", { method: "POST", body, userId });
}

export interface UpsertEntityBody {
  name: string;
  entity_type: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  appears_in_integration?: string;
  appears_in_handle?: string;
  appears_in_role?: string;
}

export function upsertEntity(
  body: UpsertEntityBody,
  userId?: string | null,
): Promise<{ id: string; slug: string }> {
  return api("/api/kg/entities", { method: "POST", body, userId });
}

export interface UpsertSkillBody {
  slug: string;
  name: string;
  description: string;
  steps?: string[];
  frequency?: string;
  strength_increment?: number; // 1–10
  tags?: string[];
  uses_integrations?: string[];
}

export function upsertSkill(
  body: UpsertSkillBody,
  userId?: string | null,
): Promise<{ id: string; slug: string }> {
  return api("/api/kg/skills", { method: "POST", body, userId });
}

export interface UpsertWorkflowBody {
  slug: string;
  name: string;
  description: string;
  trigger?: string;
  outcome?: string;
  frequency?: string;
  tags?: string[];
  skill_chain?: { slug: string; step_order: number }[];
}

export function upsertWorkflow(
  body: UpsertWorkflowBody,
  userId?: string | null,
): Promise<{ id: string; slug: string }> {
  return api("/api/kg/workflows", { method: "POST", body, userId });
}

export interface AddChatBody {
  content: string;
  source_type: string;
  source_id?: string;
  role?: "user" | "assistant";
  title?: string;
  summary?: string;
  signal_level?: "low" | "mid" | "high";
  occurred_at?: string;
  from_integration?: string;
  mentions?: { id: string; mention_type: string }[];
}

export function addChat(
  body: AddChatBody,
  userId?: string | null,
): Promise<{ id: string; chat_id: string }> {
  return api("/api/kg/chats", { method: "POST", body, userId });
}

export interface ChatRow {
  id: RecordId;
  content: string;
  source_type: string;
  source_id?: string;
  role?: "user" | "assistant";
  title?: string;
  summary?: string;
  signal_level?: "low" | "mid" | "high";
  occurred_at?: ISO8601;
}

export function getChats(
  opts: { sourceType?: string; limit?: number } = {},
  userId?: string | null,
  signal?: AbortSignal,
): Promise<ChatRow[]> {
  const sourceType = opts.sourceType ?? "ui_chat";
  const limit = opts.limit ?? 50;
  const query = new URLSearchParams({
    source_type: sourceType,
    limit: String(limit),
  });
  return api<ChatRow[]>(`/api/kg/chats?${query}`, { userId, signal });
}

export type SearchScope = "memories" | "entities" | "workflows" | "all";

export interface KnowledgeSearchResult {
  kind: "memories" | "entities" | "workflows" | "integrations";
  id: string;
  focus: string;
  snippet: string;
  score: number;
  name?: string;
  connections?: Array<{ slug?: string; name?: string }>;
}

export interface KnowledgeSearchResponse {
  query: string;
  scope: SearchScope;
  count: number;
  results: KnowledgeSearchResult[];
}

export interface CandidateEvidence {
  type: "chat" | "entity" | "memory";
  id: string;
  text: string;
}

export interface AutomationCandidate {
  id: string;
  title: string;
  story: string;
  suggested_action: string;
  signal_axes: Record<string, unknown> & {
    kind?: string;
    risk_tier?: number;
    /** answer choices for `kind: "question"` candidates; free text is always allowed */
    options?: string[];
  };
  status: CandidateStatus;
  /** the user's answer when a question candidate was resolved (`status: "done"`) */
  answer?: string | null;
  time_sensitive_until?: string | null;
  created_at?: string;
  updated_at?: string;
  evidence: CandidateEvidence[];
}

export interface TodayResponse {
  needs_you: AutomationCandidate[];
  suggestions: AutomationCandidate[];
  recent: Array<{
    id: string;
    title: string;
    source_type: string;
    occurred_at?: string;
  }>;
}

export function getToday(userId?: string | null, signal?: AbortSignal): Promise<TodayResponse> {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return api<TodayResponse>(`/api/kg/today${query}`, { userId, signal });
}

export type CandidateStatus = "open" | "suggested" | "accepted" | "dismissed" | "done";

export function updateCandidateStatus(
  id: string,
  status: Exclude<CandidateStatus, "suggested">,
  userId?: string | null,
  answer?: string,
): Promise<AutomationCandidate> {
  return api<AutomationCandidate>(`/api/kg/candidates/${encodeURIComponent(id)}`, {
    method: "POST",
    body: answer === undefined ? { status } : { status, answer },
    userId,
  });
}

export function searchKg(
  query: string,
  scope: SearchScope = "all",
  userId?: string | null,
  signal?: AbortSignal,
): Promise<KnowledgeSearchResponse> {
  const params = new URLSearchParams({ query, scope });
  return api<KnowledgeSearchResponse>(`/api/kg/search?${params}`, {
    userId,
    signal,
  });
}

/* ============================== system ============================ */

export async function listToolkits(): Promise<Toolkit[]> {
  const r = await api<{ toolkits: Toolkit[] }>("/api/composio/toolkits");
  return r.toolkits ?? [];
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return api<HealthResponse>("/api/health", { signal });
}

/** Cheap health probe that never blocks the UI on failure. */
export async function warmUp(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/api/health`, { method: "GET" });
  } catch {
    /* swallow — health poll will surface degraded mode */
  }
}
