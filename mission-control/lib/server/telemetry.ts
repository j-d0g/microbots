import "server-only";
import { addFeed, getAgent, patchAgent } from "./store";
import { estimateCost } from "./pricing";
import { shortId } from "./ids";
import type { FeedEvent } from "@/lib/types";

export function createRunId(): string {
  return shortId("run");
}

export function stepTelemetry(agentId: string, runId: string, fallbackModel: string) {
  const starts = new Map<number, number>();
  return {
    onStepStart: (step: { stepNumber?: number }) => {
      starts.set(step.stepNumber ?? 0, Date.now());
    },
    onStepEnd: async (step: {
      usage?: { inputTokens?: number; outputTokens?: number };
      model?: { provider?: string; modelId?: string };
      stepNumber?: number;
    }): Promise<void> => {
      const stepNumber = step.stepNumber ?? 0;
      const inputTokens = step.usage?.inputTokens ?? 0;
      const outputTokens = step.usage?.outputTokens ?? 0;
      const model = step.model?.provider && step.model.modelId && step.model.provider !== "mission-control"
        ? `${step.model.provider}:${step.model.modelId}`
        : fallbackModel;
      const costUsd = estimateCost(model, inputTokens, outputTokens);
      const ms = Date.now() - (starts.get(stepNumber) ?? Date.now());
      const agent = getAgent(agentId);
      if (agent) patchAgent(agentId, { tokens: agent.tokens + inputTokens + outputTokens, costUsd: agent.costUsd + costUsd });
      addFeed({
        kind: "llm",
        level: "info",
        agentId,
        taskId: null,
        runId,
        title: `${model} step ${stepNumber}`,
        body: `${inputTokens} input · ${outputTokens} output tokens`,
        data: { model, inputTokens, outputTokens, ms, costUsd, step: stepNumber },
      });
    },
  };
}

export interface TraceContext {
  agentId: string;
  taskId?: string | null;
  runId?: string | null;
  input?: unknown;
}

function summary(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return (text || "").slice(0, 600);
}

function addTraceEvent(
  toolName: string,
  context: TraceContext,
  output: unknown,
  ok: boolean,
  ms: number,
): void {
  addFeed({
    kind: "tool",
    level: ok ? "info" : "urgent",
    agentId: context.agentId,
    taskId: context.taskId ?? null,
    runId: context.runId ?? null,
    title: toolName,
    body: summary(output),
    data: { tool: toolName, input: summary(context.input), output: summary(output), ok, ms },
  } satisfies Omit<FeedEvent, "id" | "ts">);
}

export async function traced<T>(
  toolName: string,
  context: TraceContext,
  execute: () => T | Promise<T>,
): Promise<T | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const output = await execute();
    addTraceEvent(toolName, context, output, true, Date.now() - started);
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = { ok: false as const, error: message };
    addTraceEvent(toolName, context, result, false, Date.now() - started);
    return result;
  }
}
