import "server-only";
import { isStepCount, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import type { Agent, Focus, Priority, TaskStatus } from "@/lib/types";
import { widgetSchema } from "@/lib/widgets";
import { answerAsk, startTask } from "./arms";
import { publish } from "./bus";
import { ensureBooted } from "./boot";
import { shortId } from "./ids";
import { getModel, modelLabel } from "./model";
import {
  addFeed,
  addMessage,
  createTask,
  getAgent,
  listAgents,
  patchTask,
  setFocus,
  setView,
  showWidgets,
  snapshot,
  upsertAgent,
} from "./store";
import { createRunId, stepTelemetry, traced } from "./telemetry";

type TurnState = typeof globalThis & { __missionControlShepherdMutex?: Promise<void> };
const turnState = globalThis as TurnState;

async function withTurnLock<T>(run: () => Promise<T>): Promise<T> {
  const previous = turnState.__missionControlShepherdMutex ?? Promise.resolve();
  let release!: () => void;
  turnState.__missionControlShepherdMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

const prioritySchema = z.enum(["p0", "p1", "p2", "p3"]);
const taskStatusSchema = z.enum(["backlog", "todo", "doing", "review", "done"]);

function spokenGist(text: string): string {
  return text.trim().split(/\s+/).slice(0, 12).join(" ");
}

function currentSummary(): string {
  const current = snapshot();
  const openTasks = current.tasks.filter((task) => task.status !== "done");
  const openAsks = openTasks
    .filter((task) => task.ask && task.ask.answer === null)
    .map((task) => ({ id: task.id, question: task.ask?.question, options: task.ask?.options }));
  return JSON.stringify({
    agents: current.agents.map(({ id, name, status, currentTaskId, lastLine }) => ({ id, name, status, currentTaskId, lastLine })),
    tasks: openTasks.map(({ id, title, status, priority, agentId }) => ({ id, title, status, priority, agentId })),
    openAsks,
    focus: current.focus,
  });
}

function spawnAgent(input: { name: string; role: string; goal: string; voice?: string }): Agent {
  const colors = ["#34d399", "#fb7185", "#fbbf24", "#818cf8", "#2dd4bf", "#c084fc"];
  const used = new Set(listAgents().map((agent) => agent.color.toLowerCase()));
  const color = colors.find((candidate) => !used.has(candidate.toLowerCase())) ?? colors[listAgents().length % colors.length];
  const now = Date.now();
  const agent: Agent = {
    id: shortId("agent"),
    name: input.name,
    role: input.role,
    goal: input.goal,
    voice: input.voice ?? "sage",
    color,
    status: "idle",
    currentTaskId: null,
    lastLine: "Ready for a focused assignment.",
    tokens: 0,
    costUsd: 0,
    createdAt: now,
    updatedAt: now,
  };
  return upsertAgent(agent);
}

function shepherdTools(runId: string) {
  const context = { agentId: "shepherd", runId };
  return {
    create_task: tool({
      description: "Create a task and optionally assign it to an arm.",
      inputSchema: z.object({
        title: z.string().min(1).max(240),
        description: z.string().max(2_000).optional(),
        priority: prioritySchema.default("p2"),
        agentId: z.string().optional(),
      }),
      execute: (input) => traced("create_task", { ...context, input }, () => {
        const task = createTask({
          title: input.title,
          description: input.description,
          priority: input.priority as Priority,
          agentId: input.agentId,
        });
        if (task.agentId) startTask(task.id);
        return task;
      }),
    }),
    assign_task: tool({
      description: "Assign an existing task to an agent and start it if ready.",
      inputSchema: z.object({ taskId: z.string(), agentId: z.string() }),
      execute: (input) => traced("assign_task", { ...context, input }, () => {
        if (!getAgent(input.agentId)) throw new Error("That agent does not exist.");
        const task = patchTask(input.taskId, { agentId: input.agentId });
        if (!task) throw new Error("That task does not exist.");
        if (task.status === "doing") startTask(task.id);
        return task;
      }),
    }),
    update_task: tool({
      description: "Update a task's title, priority, or status.",
      inputSchema: z.object({
        taskId: z.string(),
        status: taskStatusSchema.optional(),
        priority: prioritySchema.optional(),
        title: z.string().min(1).max(240).optional(),
      }),
      execute: (input) => traced("update_task", { ...context, input }, () => {
        const patch: { status?: TaskStatus; priority?: Priority; title?: string } = {};
        if (input.status) patch.status = input.status as TaskStatus;
        if (input.priority) patch.priority = input.priority as Priority;
        if (input.title) patch.title = input.title;
        const task = patchTask(input.taskId, patch);
        if (!task) throw new Error("That task does not exist.");
        if (task.status === "doing" && task.agentId) startTask(task.id);
        return task;
      }),
    }),
    spawn_agent: tool({
      description: "Create a named specialist agent for ongoing work.",
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        role: z.string().min(1).max(120),
        goal: z.string().min(1).max(800),
        voice: z.string().optional(),
      }),
      execute: (input) => traced("spawn_agent", { ...context, input }, () => spawnAgent(input)),
    }),
    set_focus: tool({
      description: "Set today's priorities and recommended next actions.",
      inputSchema: z.object({
        items: z.array(z.object({ title: z.string(), why: z.string(), taskId: z.string().optional() })).max(8),
        recommendations: z.array(z.object({ title: z.string(), why: z.string(), prompt: z.string() })).max(8),
      }),
      execute: (input) => traced("set_focus", { ...context, input }, () => setFocus(input as Omit<Focus, "updatedAt">)),
    }),
    show: tool({
      description: "Draw typed widgets on the stage.",
      inputSchema: z.object({ widgets: z.array(widgetSchema).min(1).max(6), mode: z.enum(["replace", "append"]).default("append") }),
      execute: (input) => traced("show", { ...context, input }, () => showWidgets(input.widgets, input.mode)),
    }),
    navigate: tool({
      description: "Switch the main dashboard view.",
      inputSchema: z.object({ view: z.enum(["stage", "agents", "tasks"]) }),
      execute: (input) => traced("navigate", { ...context, input }, () => setView(input.view)),
    }),
    notify: tool({
      description: "Send Jordan a dashboard notification.",
      inputSchema: z.object({ title: z.string().min(1).max(160), body: z.string().min(1).max(600), level: z.enum(["info", "important", "urgent"]).default("info") }),
      execute: (input) => traced("notify", { ...context, input }, () => addFeed({
        kind: "notification",
        level: input.level,
        agentId: "shepherd",
        taskId: null,
        runId,
        title: input.title,
        body: input.body,
        data: null,
      })),
    }),
    answer_ask: tool({
      description: "Answer an open question and resume its task.",
      inputSchema: z.object({ taskId: z.string(), answer: z.string().min(1).max(1_000) }),
      execute: (input) => traced("answer_ask", { ...context, input }, async () => {
        const answered = await answerAsk(input.taskId, input.answer);
        if (!answered) throw new Error("That task has no unanswered question.");
        return { ok: true };
      }),
    }),
  };
}

export async function runShepherdTurn(text: string): Promise<{ reply: string }> {
  return withTurnLock(async () => {
    ensureBooted();
    const userText = text.trim();
    if (!userText) throw new Error("A message is required.");
    const current = snapshot();
    const runId = createRunId();
    addMessage({ role: "user", agentId: "shepherd", text: userText });
    publish({ type: "thinking", agentId: "shepherd", on: true });
    try {
      const instructions = [
        "You are Jordan's chief of staff in Mission Control.",
        "Reply for the ear: 1–3 short plain sentences, no IDs, paths, URLs or markdown.",
        "Delegate: a one-off goes to the best-fit existing arm; a new lasting area of work gets spawn_agent.",
        "Keep the stage relevant: anything visual goes through show; keep the focus current.",
        "Never invent work Jordan didn't ask for. You may add recommendations.",
        `Current live state: ${currentSummary()}`,
      ].join("\n");
      const telemetry = stepTelemetry("shepherd", runId, modelLabel());
      const runner = new ToolLoopAgent({
        id: "shepherd",
        model: getModel({ kind: "shepherd", userText, snapshot: current }),
        instructions,
        tools: shepherdTools(runId),
        stopWhen: isStepCount(6),
      });
      const response = await runner.generate({
        prompt: userText,
        onStepStart: telemetry.onStepStart,
        onStepEnd: telemetry.onStepEnd,
      });
      const reply = response.text.trim() || "I’ve updated the board and kept the next step clear.";
      addMessage({ role: "assistant", agentId: "shepherd", text: reply });
      publish({
        type: "speak",
        speak: {
          id: shortId("speak"),
          agentId: "shepherd",
          text: reply,
          gist: spokenGist(reply),
          level: "info",
          fast: reply.length < 120 && !/\b(urgent|critical|important)\b/i.test(reply),
        },
      });
      return { reply };
    } finally {
      publish({ type: "thinking", agentId: "shepherd", on: false });
    }
  });
}
