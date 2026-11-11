import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { hasToolCall, isStepCount, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import type { Agent, Task } from "@/lib/types";
import { armScenario, getModel, isDemo, modelLabel } from "./model";
import { addArtifact, addFeed, getAgent, getTask, listAgents, patchAgent, patchTask } from "./store";
import { createRunId, stepTelemetry, traced } from "./telemetry";
import { shortId } from "./ids";
import { publish } from "./bus";
import { ensureBooted } from "./boot";

interface QueueState {
  running: Set<string>;
  queued: string[];
  promises: Map<string, Promise<void>>;
}

type QueueGlobal = typeof globalThis & { __missionControlArmQueue?: QueueState };
const globalState = globalThis as QueueGlobal;

function queue(): QueueState {
  return (globalState.__missionControlArmQueue ??= {
    running: new Set<string>(),
    queued: [],
    promises: new Map<string, Promise<void>>(),
  });
}

function maxArms(): number {
  const value = Number(process.env.MC_MAX_ARMS ?? 3);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 3;
}

function blockedByHuman(task: Task): boolean {
  return Boolean(task.ask && task.ask.answer === null);
}

function isAgentBusy(task: Task): boolean {
  const agent = task.agentId ? getAgent(task.agentId) : undefined;
  return Boolean(agent && (agent.status === "running" || agent.status === "needs_you"));
}

function safeIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19));
  }
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") || normalized.startsWith("::ffff:");
}

async function assertPublicUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only public HTTP(S) URLs are allowed.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local network URLs are not allowed.");
  }
  if (isIP(host)) {
    if (safeIp(host)) throw new Error("Private network URLs are not allowed.");
    return url;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => safeIp(address))) {
    throw new Error("Private or unresolved network URLs are not allowed.");
  }
  return url;
}

async function readLimited(response: Response, maxBytes = 100_000): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (length >= maxBytes) await reader.cancel();
  } finally {
    reader.releaseLock();
  }
  return text;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8_000);
}

function speak(agent: Agent, text: string, level: "important" | "urgent", fast: boolean): void {
  const words = text.trim().split(/\s+/).slice(0, 12);
  publish({
    type: "speak",
    speak: { id: shortId("speak"), agentId: agent.id, text, gist: words.join(" "), level, fast },
  });
}

function notify(agentId: string, taskId: string, runId: string, title: string, body: string, level: "important" | "urgent"): void {
  addFeed({ kind: "notification", level, agentId, taskId, runId, title, body, data: null });
}

function buildTools(task: Task, agent: Agent, runId: string, finish: (summary: string) => void, ask: () => void) {
  const context = { agentId: agent.id, taskId: task.id, runId };
  return {
    web_fetch: tool({
      description: "Fetch a public web page and return a short, readable excerpt.",
      inputSchema: z.object({ url: z.string().url().max(2048) }),
      execute: (input) => traced("web_fetch", { ...context, input }, async () => {
        const url = await assertPublicUrl(input.url);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
          headers: { "user-agent": "MissionControl/1.0" },
        });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
        return { url: url.toString(), text: stripHtml(await readLimited(response)) };
      }),
    }),
    report_progress: tool({
      description: "Post a concise progress update for this task.",
      inputSchema: z.object({ line: z.string().min(1).max(240) }),
      execute: (input) => traced("report_progress", { ...context, input }, () => {
        patchAgent(agent.id, { lastLine: input.line });
        addFeed({
          kind: "log",
          level: "info",
          agentId: agent.id,
          taskId: task.id,
          runId,
          title: `${agent.name} · progress`,
          body: input.line,
          data: null,
        });
        return { ok: true };
      }),
    }),
    write_artifact: tool({
      description: "Save a markdown artifact linked to this task.",
      inputSchema: z.object({ title: z.string().min(1).max(160), content: z.string().min(1).max(20_000) }),
      execute: (input) => traced("write_artifact", { ...context, input }, () => {
        const artifact = addArtifact({ taskId: task.id, agentId: agent.id, title: input.title, content: input.content });
        const current = getTask(task.id);
        if (current && !current.artifactIds.includes(artifact.id)) {
          patchTask(task.id, { artifactIds: [...current.artifactIds, artifact.id] });
        }
        return artifact;
      }),
    }),
    ask_human: tool({
      description: "Pause this task when a decision from Jordan is needed.",
      inputSchema: z.object({ question: z.string().min(1).max(500), options: z.array(z.string().min(1).max(200)).min(2).max(3) }),
      execute: (input) => traced("ask_human", { ...context, input }, () => {
        patchTask(task.id, {
          ask: { question: input.question, options: input.options, askedAt: Date.now(), answer: null },
        });
        patchAgent(agent.id, { status: "needs_you", currentTaskId: task.id, lastLine: input.question });
        notify(agent.id, task.id, runId, "Decision needed", input.question, "urgent");
        speak(agent, `${agent.name} needs your input: ${input.question}`, "urgent", false);
        ask();
        return { ok: true, question: input.question, options: input.options };
      }),
    }),
    complete_task: tool({
      description: "Mark the task ready for review with a short result.",
      inputSchema: z.object({ summary: z.string().min(1).max(1_200) }),
      execute: (input) => traced("complete_task", { ...context, input }, () => {
        finish(input.summary);
        return { ok: true, status: "review" };
      }),
    }),
  };
}

function beginTask(taskId: string): void {
  const state = queue();
  const task = getTask(taskId);
  if (!task || !task.agentId || state.running.has(taskId)) return;
  const agent = getAgent(task.agentId);
  if (!agent) return;
  state.running.add(taskId);
  patchTask(task.id, { status: "doing" });
  const runningAgent = patchAgent(agent.id, {
    status: "running",
    currentTaskId: task.id,
    lastLine: `Working on ${task.title}.`,
  });
  if (!runningAgent) {
    state.running.delete(taskId);
    return;
  }
  const promise = runTask(task, runningAgent, task.ask?.answer ?? undefined).finally(() => {
    state.running.delete(taskId);
    state.promises.delete(taskId);
    pumpQueue();
  });
  state.promises.set(taskId, promise);
}

function recoverOrphanedAgents(): void {
  const state = queue();
  for (const agent of listAgents()) {
    if (state.running.size >= maxArms()) return;
    if (agent.status !== "running" || !agent.currentTaskId || state.running.has(agent.currentTaskId)) continue;
    const task = getTask(agent.currentTaskId);
    if (task?.status === "doing" && !blockedByHuman(task)) beginTask(task.id);
  }
}

function pumpQueue(): void {
  const state = queue();
  recoverOrphanedAgents();
  while (state.running.size < maxArms()) {
    const index = state.queued.findIndex((id) => {
      const task = getTask(id);
      return Boolean(task && task.agentId && !blockedByHuman(task) && !isAgentBusy(task));
    });
    if (index < 0) return;
    const [taskId] = state.queued.splice(index, 1);
    beginTask(taskId);
  }
}

export function startTask(taskId: string): void {
  ensureBooted();
  const task = getTask(taskId);
  if (!task || !task.agentId || blockedByHuman(task)) return;
  const state = queue();
  recoverOrphanedAgents();
  if (state.running.has(taskId) || state.queued.includes(taskId)) return;
  if (state.running.size >= maxArms() || isAgentBusy(task)) {
    state.queued.push(taskId);
    return;
  }
  beginTask(taskId);
}

async function runTask(task: Task, agent: Agent, answer?: string): Promise<void> {
  const runId = createRunId();
  let completed = false;
  let waitingForHuman = false;
  let resultText = "";
  const finish = (summary: string) => {
    if (completed) return;
    completed = true;
    resultText = summary;
    patchTask(task.id, { status: "review", result: summary });
    patchAgent(agent.id, { status: "idle", currentTaskId: null, lastLine: `Finished ${task.title}.` });
    notify(agent.id, task.id, runId, "Task ready for review", summary, "important");
    speak(agent, `${agent.name} finished ${task.title}. ${summary}`, "important", true);
  };
  const markWaiting = () => {
    waitingForHuman = true;
  };

  try {
    const system = [
      `You are ${agent.name}, a focused Mission Control specialist.`,
      agent.goal,
      "Use tools to make progress, save a concise markdown artifact, and report a useful result.",
      "Ask Jordan only when a decision is genuinely needed. Never invent evidence.",
    ].join("\n");
    const tools = buildTools(task, agent, runId, finish, markWaiting);
    const telemetry = stepTelemetry(agent.id, runId, modelLabel());
    const model = getModel(armScenario(task, answer));
    const runner = new ToolLoopAgent({
      id: agent.id,
      model,
      instructions: system,
      tools,
      stopWhen: [isStepCount(8), hasToolCall("ask_human")],
    });
    const response = await runner.generate({
      prompt: [
        `Task: ${task.title}`,
        `Description: ${task.description}`,
        answer ? `Jordan's answer: ${answer}` : "",
        "Work in a concise, evidence-led way.",
      ].filter(Boolean).join("\n"),
      onStepStart: telemetry.onStepStart,
      onStepEnd: telemetry.onStepEnd,
    });
    resultText = response.text || resultText;
    if (!completed && !waitingForHuman) finish(resultText || `Completed the first pass on ${task.title}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addFeed({
      kind: "notification",
      level: "urgent",
      agentId: agent.id,
      taskId: task.id,
      runId,
      title: `${agent.name} hit an error`,
      body: message,
      data: null,
    });
    patchTask(task.id, { status: "todo" });
    patchAgent(agent.id, { status: "idle", currentTaskId: null, lastLine: "Run failed; task returned to the board." });
  } finally {
    if (!completed && !waitingForHuman) {
      const current = getTask(task.id);
      if (current?.status === "doing") patchTask(task.id, { status: "todo" });
    }
  }
}

export async function answerAsk(taskId: string, answer: string): Promise<boolean> {
  ensureBooted();
  const task = getTask(taskId);
  if (!task?.ask || task.ask.answer !== null || !answer.trim()) return false;
  const updated = patchTask(taskId, { ask: { ...task.ask, answer: answer.trim() } });
  if (!updated || !updated.agentId) return false;
  addFeed({
    kind: "log",
    level: "info",
    agentId: updated.agentId,
    taskId,
    runId: null,
    title: "Jordan answered",
    body: answer.trim(),
    data: null,
  });
  patchAgent(updated.agentId, { status: "idle", currentTaskId: taskId, lastLine: "Jordan answered; resuming work." });
  startTask(taskId);
  return true;
}

export async function waitForIdle(): Promise<void> {
  const state = queue();
  while (state.running.size || state.promises.size) {
    const active = [...state.promises.values()];
    if (active.length) await Promise.allSettled(active);
    else await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
