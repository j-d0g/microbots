/**
 * Microbots backend client.
 *
 * One file, no extra deps. Wraps the live unified service exposing
 * Composio OAuth + the SurrealDB-backed knowledge graph.
 *
 * Conventions:
 *   - Base URL defaults to the deployed Render instance, overridable
 *     via `NEXT_PUBLIC_MICROBOTS_BASE_URL`.
 *   - Every request injects `X-User-Id` if the caller has set one. KG
 *     read endpoints currently ignore this (single-tenant for the
 *     hackathon), but Composio routes require it as the namespace key
 *     and the header is forward-compatible the day KG goes per-user.
 *   - 4xx/5xx bodies are `{ detail: string }`; we surface them as
 *     typed `BackendError(detail, status)` so UI code can render the
 *     server's human message.
 *
 * Doc reference: docs/api-reference.md.
 */

const DEFAULT_BASE = "https://app-bf31.onrender.com";

/** Resolved at module load. SSR-safe — falls back to the default. */
export const BASE_URL: string =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_MICROBOTS_BASE_URL) ||
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

export interface IntegrationSummary {
  slug: string;
  name: string;
  category?: string;
  frequency?: string;
  description?: string;
  user_purpose?: string;
  co_used_with_slugs?: { out: { slug: string } }[];
}

export interface IntegrationDetail extends IntegrationSummary {
  entities?: Array<{ id: string; name: string; entity_type?: string }>;
  top_memories?: Memory[];
  skills?: Skill[];
}

export interface Memory {
  id: string;
  content: string;
  memory_type: string;
  confidence: number;
  source?: string;
  tags?: string[];
  created_at?: string;
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  frequency?: string;
  strength: number;
  tags?: string[];
  integrations?: string[];
}

export interface Workflow {
  id: string;
  slug: string;
  name: string;
  description: string;
  trigger?: string;
  outcome?: string;
  skill_chain?: { out: { skill_slug: string }; step_order: number }[];
}

export interface EntityRow {
  id: string;
  name: string;
  entity_type: string;
  aliases?: string[];
  tags?: string[];
  chat_mention_count?: number;
}

export interface EntityTypeCount {
  entity_type: string;
  count: number;
}

export interface HealthResponse {
  status: string;
  service: string;
  surreal: { ok: boolean; table_count?: number };
  composio: { ok: boolean; toolkit_count?: number };
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
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
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
): Promise<IntegrationSummary[]> {
  return api<IntegrationSummary[]>("/api/kg/integrations", { userId });
}

export function getKgIntegration(
  slug: string,
  userId?: string | null,
  limit = 10,
): Promise<IntegrationDetail> {
  return api<IntegrationDetail>(
    `/api/kg/integrations/${encodeURIComponent(slug)}?limit=${limit}`,
    { userId },
  );
}

export function getKgMemories(
  opts: { by?: "confidence" | "recency"; limit?: number } = {},
  userId?: string | null,
): Promise<Memory[]> {
  const by = opts.by ?? "confidence";
  const limit = opts.limit ?? 20;
  return api<Memory[]>(
    `/api/kg/memories?by=${by}&limit=${limit}`,
    { userId },
  );
}

export function getKgSkills(
  opts: { minStrength?: number } = {},
  userId?: string | null,
): Promise<Skill[]> {
  const min = opts.minStrength ?? 1;
  return api<Skill[]>(`/api/kg/skills?min_strength=${min}`, { userId });
}

export function getKgWorkflows(userId?: string | null): Promise<Workflow[]> {
  return api<Workflow[]>("/api/kg/workflows", { userId });
}

export function getKgEntityTypes(
  userId?: string | null,
): Promise<EntityTypeCount[]> {
  return api<EntityTypeCount[]>("/api/kg/entity-types", { userId });
}

export function getKgEntities(
  entityType?: string,
  userId?: string | null,
): Promise<EntityRow[]> {
  const q = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : "";
  return api<EntityRow[]>(`/api/kg/entities${q}`, { userId });
}

/* ============================== KG writes ========================= */
/* Scaffolded for future agent tools — not yet wired. */

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

/* ============================== system ============================ */

export async function listToolkits(): Promise<Toolkit[]> {
  const r = await api<{ toolkits: Toolkit[] }>("/api/composio/toolkits");
  return r.toolkits ?? [];
}

export function getHealth(): Promise<HealthResponse> {
  return api<HealthResponse>("/api/health");
}

/** Cheap probe — wakes the free-tier Render dyno. Resolves to `void`
 *  even on failure so the caller doesn't block UI on cold starts. */
export async function warmUp(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/health`, { method: "GET" });
  } catch {
    /* swallow — health poll will surface degraded mode */
  }
}
