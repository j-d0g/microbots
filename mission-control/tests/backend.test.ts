import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Agent, Artifact, BusEvent, ChatMessage, FeedEvent, Focus, Snapshot, Task } from "@/lib/types";
import { widgetSchema } from "@/lib/widgets";
import { reduce } from "@/lib/client/reducer";
import { answerAsk, waitForIdle } from "@/lib/server/arms";
import { ensureBooted } from "@/lib/server/boot";
import { subscribe } from "@/lib/server/bus";
import { clearDb, closeDb } from "@/lib/server/db";
import { runShepherdTurn } from "@/lib/server/shepherd";
import {
  addArtifact,
  addFeed,
  addMessage,
  createTask,
  deleteTask,
  getAgent,
  listAgents,
  listTasks,
  patchAgent,
  patchTask,
  setFocus,
  setView,
  showWidgets,
  snapshot,
  upsertAgent,
} from "@/lib/server/store";

const dataDir = mkdtempSync(join(tmpdir(), "mission-control-test-"));
process.env.MC_DATA_DIR = dataDir;
process.env.MC_DEMO_DELAY_MS = "0";
process.env.MC_MODEL = "demo";

const emptySnapshot: Snapshot = {
  agents: [],
  tasks: [],
  artifacts: [],
  feed: [],
  messages: [],
  focus: { items: [], recommendations: [], updatedAt: 0 },
  stage: { view: "stage", widgets: [] },
  demo: true,
  model: "demo",
  voice: { tts: false, stt: false },
};

const agent: Agent = {
  id: "agent-test",
  name: "Test",
  role: "testing",
  goal: "Test the store.",
  voice: "sage",
  color: "#22d3ee",
  status: "idle",
  currentTaskId: null,
  lastLine: null,
  tokens: 0,
  costUsd: 0,
  createdAt: 1,
  updatedAt: 1,
};

const task: Task = {
  id: "task-test",
  title: "Test task",
  description: "",
  status: "todo",
  priority: "p2",
  agentId: null,
  ask: null,
  result: null,
  artifactIds: [],
  createdAt: 1,
  updatedAt: 1,
};

const artifact: Artifact = {
  id: "artifact-test",
  taskId: task.id,
  agentId: agent.id,
  title: "Notes",
  content: "A short note.",
  createdAt: 1,
};

const feedEvent: FeedEvent = {
  id: "feed-test",
  ts: 1,
  kind: "log",
  level: "info",
  agentId: agent.id,
  taskId: task.id,
  runId: null,
  title: "Progress",
  body: "Working.",
  data: null,
};

const message: ChatMessage = {
  id: "message-test",
  role: "assistant",
  agentId: "shepherd",
  text: "Ready.",
  ts: 1,
};

const focus: Focus = {
  items: [{ title: "Test", why: "Testing." }],
  recommendations: [],
  updatedAt: 1,
};

beforeEach(async () => {
  await waitForIdle();
  clearDb();
  ensureBooted();
});

afterAll(() => closeDb());

describe("client reducer", () => {
  it("reduces every bus event type and ignores speech and thinking", () => {
    let state = reduce(emptySnapshot, { type: "snapshot", snapshot: emptySnapshot });
    state = reduce(state, { type: "agent", agent });
    state = reduce(state, { type: "task", task });
    state = reduce(state, { type: "artifact", artifact });
    state = reduce(state, { type: "feed", event: feedEvent });
    state = reduce(state, { type: "message", message });
    state = reduce(state, { type: "focus", focus });
    state = reduce(state, { type: "stage", stage: { view: "agents", widgets: [] } });
    expect(reduce(state, { type: "speak", speak: { id: "s", agentId: "shepherd", text: "Hi", gist: "Hi", level: "info", fast: true } })).toBe(state);
    expect(reduce(state, { type: "thinking", agentId: "shepherd", on: true })).toBe(state);

    expect(state.agents).toEqual([agent]);
    expect(state.tasks).toEqual([task]);
    expect(state.artifacts).toEqual([artifact]);
    expect(state.feed).toEqual([feedEvent]);
    expect(state.messages).toEqual([message]);
    expect(state.focus).toEqual(focus);
    expect(state.stage.view).toBe("agents");

    state = reduce(state, { type: "task_deleted", id: task.id });
    expect(state.tasks).toEqual([]);
  });

  it("upserts records and caps feed and messages", () => {
    const events: FeedEvent[] = Array.from({ length: 301 }, (_, index) => ({ ...feedEvent, id: `event-${index}`, ts: index }));
    const messages: ChatMessage[] = Array.from({ length: 101 }, (_, index) => ({ ...message, id: `message-${index}`, ts: index }));
    const state = reduce(
      { ...emptySnapshot, agents: [agent], feed: events.slice(0, -1), messages: messages.slice(0, -1) },
      { type: "feed", event: events[300] },
    );
    const capped = reduce(state, { type: "message", message: messages[100] });
    expect(capped.feed).toHaveLength(300);
    expect(capped.feed[0].id).toBe("event-1");
    expect(capped.messages).toHaveLength(100);
    expect(capped.messages[0].id).toBe("message-1");
    expect(reduce(capped, { type: "agent", agent: { ...agent, name: "Updated" } }).agents[0].name).toBe("Updated");
  });
});

describe("widget validation and persistent store", () => {
  it("accepts valid widgets and rejects malformed ones", () => {
    expect(widgetSchema.safeParse({ kind: "brief", title: "Brief", bullets: ["One point"] }).success).toBe(true);
    expect(widgetSchema.safeParse({ kind: "brief", title: "Broken", bullets: [] }).success).toBe(false);
    expect(widgetSchema.safeParse({ kind: "unknown", title: "Bad" }).success).toBe(false);
  });

  it("publishes the matching event for every store mutation", () => {
    const events: BusEvent[] = [];
    const unsubscribe = subscribe((event) => events.push(event));
    try {
      upsertAgent(agent);
      patchAgent(agent.id, { lastLine: "Updated." });
      const created = createTask({ title: "Persist this task" });
      patchTask(created.id, { status: "review" });
      addArtifact({ taskId: created.id, agentId: agent.id, title: "Artifact", content: "Text." });
      addFeed({ kind: "log", level: "info", agentId: agent.id, taskId: created.id, runId: null, title: "Log", body: null, data: null });
      addMessage({ role: "assistant", agentId: "shepherd", text: "Saved." });
      setFocus({ items: [], recommendations: [] });
      showWidgets([{ kind: "brief", title: "Brief", bullets: ["One"] }], "replace");
      setView("tasks");
      deleteTask(created.id);
    } finally {
      unsubscribe();
    }
    expect(events.map((event) => event.type)).toEqual([
      "agent", "agent", "task", "task", "artifact", "feed", "message", "focus", "stage", "stage", "task_deleted",
    ]);
  });
});

describe("demo agent workflows", () => {
  it("delegates research, saves an artifact, and records tokenized LLM and tool steps", async () => {
    const { reply } = await runShepherdTurn("research the Pi agent harness");
    await waitForIdle();
    const delegated = listTasks().find((item) => item.title === "Research the Pi agent harness");
    expect(reply).toMatch(/specialist/i);
    expect(delegated?.agentId).toBe("scout");
    expect(delegated?.status).toBe("review");
    expect(delegated?.artifactIds.length).toBeGreaterThan(0);
    const current = snapshot();
    expect(current.artifacts.some((item) => item.taskId === delegated?.id)).toBe(true);
    const llm = current.feed.filter((event) => event.kind === "llm" && event.agentId === "scout");
    const tools = current.feed.filter((event) => event.kind === "tool" && event.agentId === "scout");
    expect(llm.length).toBeGreaterThan(0);
    expect(Number(llm[0].data?.inputTokens)).toBeGreaterThan(0);
    expect(Number(llm[0].data?.outputTokens)).toBeGreaterThan(0);
    expect(tools.some((event) => event.data?.tool === "write_artifact")).toBe(true);
  });

  it("pauses for a decision and resumes to review after an answer", async () => {
    const events: BusEvent[] = [];
    const unsubscribe = subscribe((event) => events.push(event));
    try {
      await runShepherdTurn("decide which eval to fix first");
      await waitForIdle();
      const decisionTask = listTasks().find((item) => item.title === "Decide which eval to fix first");
      expect(decisionTask?.ask?.answer).toBeNull();
      expect(decisionTask?.ask?.options.length).toBeGreaterThanOrEqual(2);
      expect(getAgent(decisionTask?.agentId ?? "")?.status).toBe("needs_you");
      expect(events.some((event) => event.type === "speak" && event.speak.level === "urgent" && event.speak.agentId === "scout")).toBe(true);
      expect(events.some((event) => event.type === "feed" && event.event.level === "urgent")).toBe(true);

      await answerAsk(decisionTask!.id, decisionTask!.ask!.options[0]);
      await waitForIdle();
      expect(listTasks().find((item) => item.id === decisionTask!.id)?.status).toBe("review");
    } finally {
      unsubscribe();
    }
  });

  it("spawns a named specialist from a shepherd turn", async () => {
    await runShepherdTurn("spawn a new agent named QA");
    const spawned = listAgents().find((item) => item.name === "QA");
    expect(spawned?.role).toBe("specialist");
    expect(spawned?.goal).toContain("spawn a new agent named QA");
  });
});
