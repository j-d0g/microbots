import { streamText, stepCountIs } from "ai";
import { agentModel } from "./providers/openrouter";
import { createAgentTools, toolPromptSection, type AgentToolCtx } from "./tools";
import { snapshotToPrompt } from "./server-snapshot";

const ORCH_BASE = `you are microbots, a warm and capable colleague. speak in lowercase, no emojis, and reply in one or two sentences.

Understand the user's intent, use the smallest useful set of tools, and ground answers in returned data. Never describe tool calls or claim work you did not do. Never claim success when a tool returned ok:false.

In chat mode, windows appear as inline cards; prefer one or two focused cards and a short spoken-style answer. Use focus to centre a specific node, entity, or workflow.

Only write when asked. Ask a concise follow-up when intent is ambiguous.`;

export const ORCH_SYSTEM = `${ORCH_BASE}\n\nTools:\n${toolPromptSection()}`;
export const ORCH_MAX_STEPS = 4;

export interface OrchestrateInput {
  ctx: AgentToolCtx;
  query: string;
}

export function runOrchestrator({ ctx, query }: OrchestrateInput) {
  const tools = createAgentTools(ctx);
  const stream = streamText({
    model: agentModel(),
    system: ORCH_SYSTEM,
    prompt: `${snapshotToPrompt(ctx.snapshot)}\n\nuser said: ${query}`,
    tools,
    stopWhen: stepCountIs(ORCH_MAX_STEPS),
    temperature: 0.2,
  });
  return stream;
}
