import "server-only";
import type {
  Agent,
  Artifact,
  ChatMessage,
  FeedEvent,
  Focus,
  Priority,
  Snapshot,
  Stage,
  Task,
  TaskStatus,
  View,
} from "@/lib/types";
import { widgetSchema, type Widget } from "@/lib/widgets";
import { publish } from "./bus";
import { getDb } from "./db";
import { shortId } from "./ids";
import { isDemo, modelLabel, voiceAvailable } from "./model";

type Row = { id: string; data: string };
type Data = { data: string };

function parse<T>(row: Row | Data | undefined): T | undefined {
  return row ? JSON.parse(row.data) as T : undefined;
}

function list<T>(table: string, limit?: number): T[] {
  const ordering = limit ? "DESC" : "ASC";
  const suffix = limit ? " LIMIT ?" : "";
  const rows = getDb().prepare(`SELECT data FROM ${table} ORDER BY ts ${ordering}${suffix}`).all(...(limit ? [limit] : [])) as Data[];
  if (limit) rows.reverse();
  return rows.map((row) => JSON.parse(row.data) as T);
}

export function getAgent(id: string): Agent | undefined {
  return parse<Agent>(getDb().prepare("SELECT data FROM agents WHERE id = ?").get(id) as Data | undefined);
}

export function listAgents(): Agent[] {
  return list<Agent>("agents");
}

export function upsertAgent(agent: Agent): Agent {
  getDb().prepare("INSERT INTO agents(id, ts, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET ts=excluded.ts, data=excluded.data")
    .run(agent.id, agent.updatedAt, JSON.stringify(agent));
  publish({ type: "agent", agent });
  return agent;
}

export function patchAgent(id: string, patch: Partial<Omit<Agent, "id" | "createdAt">>): Agent | undefined {
  const current = getAgent(id);
  if (!current) return undefined;
  const agent = { ...current, ...patch, id, updatedAt: Date.now() };
  return upsertAgent(agent);
}

export function getTask(id: string): Task | undefined {
  return parse<Task>(getDb().prepare("SELECT data FROM tasks WHERE id = ?").get(id) as Data | undefined);
}

export function listTasks(): Task[] {
  return list<Task>("tasks");
}

export function createTask(input: {
  title: string;
  description?: string;
  priority?: Priority;
  agentId?: string | null;
  status?: TaskStatus;
}): Task {
  const now = Date.now();
  const task: Task = {
    id: shortId("task"),
    title: input.title,
    description: input.description ?? "",
    status: input.status ?? "todo",
    priority: input.priority ?? "p2",
    agentId: input.agentId ?? null,
    ask: null,
    result: null,
    artifactIds: [],
    createdAt: now,
    updatedAt: now,
  };
  getDb().prepare("INSERT INTO tasks(id, ts, data) VALUES (?, ?, ?)").run(task.id, task.updatedAt, JSON.stringify(task));
  publish({ type: "task", task });
  return task;
}

export function patchTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "agentId" | "ask" | "result" | "artifactIds">>,
): Task | undefined {
  const current = getTask(id);
  if (!current) return undefined;
  const task = { ...current, ...patch, id, updatedAt: Date.now() };
  getDb().prepare("UPDATE tasks SET ts = ?, data = ? WHERE id = ?").run(task.updatedAt, JSON.stringify(task), id);
  publish({ type: "task", task });
  return task;
}

export function deleteTask(id: string): boolean {
  const result = getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
  if (!result.changes) return false;
  publish({ type: "task_deleted", id });
  return true;
}

export function addArtifact(input: Omit<Artifact, "id" | "createdAt">): Artifact {
  const artifact: Artifact = { ...input, id: shortId("art"), createdAt: Date.now() };
  getDb().prepare("INSERT INTO artifacts(id, ts, data) VALUES (?, ?, ?)").run(artifact.id, artifact.createdAt, JSON.stringify(artifact));
  publish({ type: "artifact", artifact });
  return artifact;
}

export function listArtifacts(): Artifact[] {
  return list<Artifact>("artifacts");
}

export function addFeed(input: Omit<FeedEvent, "id" | "ts"> & { id?: string; ts?: number }): FeedEvent {
  const event: FeedEvent = { ...input, id: input.id ?? shortId("evt"), ts: input.ts ?? Date.now() };
  const db = getDb();
  db.prepare("INSERT INTO events(id, ts, data) VALUES (?, ?, ?)").run(event.id, event.ts, JSON.stringify(event));
  db.prepare("DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY ts DESC LIMIT -1 OFFSET 2000)").run();
  publish({ type: "feed", event });
  return event;
}

export function addMessage(input: Omit<ChatMessage, "id" | "ts"> & { id?: string; ts?: number }): ChatMessage {
  const message: ChatMessage = { ...input, id: input.id ?? shortId("msg"), ts: input.ts ?? Date.now() };
  getDb().prepare("INSERT INTO messages(id, ts, data) VALUES (?, ?, ?)").run(message.id, message.ts, JSON.stringify(message));
  publish({ type: "message", message });
  return message;
}

export function setFocus(input: Omit<Focus, "updatedAt"> | Focus): Focus {
  const focus: Focus = { ...input, updatedAt: Date.now() };
  getDb().prepare("INSERT INTO kv(key, ts, data) VALUES ('focus', ?, ?) ON CONFLICT(key) DO UPDATE SET ts=excluded.ts, data=excluded.data")
    .run(focus.updatedAt, JSON.stringify(focus));
  publish({ type: "focus", focus });
  return focus;
}

function getKv<T>(key: string): T | undefined {
  return parse<T>(getDb().prepare("SELECT data FROM kv WHERE key = ?").get(key) as Data | undefined);
}

function writeStage(stage: Stage): Stage {
  getDb().prepare("INSERT INTO kv(key, ts, data) VALUES ('stage', ?, ?) ON CONFLICT(key) DO UPDATE SET ts=excluded.ts, data=excluded.data")
    .run(Date.now(), JSON.stringify(stage));
  publish({ type: "stage", stage });
  return stage;
}

export function showWidgets(widgets: Widget[], mode: "replace" | "append" = "append"): Stage {
  const validated = widgets.map((widget) => widgetSchema.parse(widget));
  const current = getKv<Stage>("stage") ?? { view: "stage", widgets: [] };
  const added = validated.map((widget) => ({ id: shortId("wid"), createdAt: Date.now(), widget }));
  const combined = mode === "replace" ? added : [...current.widgets, ...added];
  return writeStage({ ...current, view: "stage", widgets: combined.slice(-6) });
}

export function setView(view: View): Stage {
  const current = getKv<Stage>("stage") ?? { view: "stage", widgets: [] };
  return writeStage({ ...current, view });
}

export function getFocus(): Focus {
  return getKv<Focus>("focus") ?? { items: [], recommendations: [], updatedAt: Date.now() };
}

export function getStage(): Stage {
  return getKv<Stage>("stage") ?? { view: "stage", widgets: [] };
}

export function snapshot(): Snapshot {
  return {
    agents: listAgents(),
    tasks: listTasks(),
    artifacts: listArtifacts(),
    feed: list<FeedEvent>("events", 300),
    messages: list<ChatMessage>("messages", 100),
    focus: getFocus(),
    stage: getStage(),
    demo: isDemo(),
    model: modelLabel(),
    voice: { tts: voiceAvailable(), stt: voiceAvailable() },
  };
}
