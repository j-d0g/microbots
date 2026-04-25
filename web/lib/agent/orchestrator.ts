/**
 * Top-level orchestrator.
 *
 * Two delegation tools and zero direct UI tools. The orchestrator
 * decides:
 *   - whether the user's intent needs the layout-agent
 *   - whether it also needs the content-agent
 *   - what short sentence to say to the user
 *
 * It then writes a short reply via plain text generation (streamed).
 * Sub-agents run inside `delegate_*.execute()` so the orchestrator
 * effectively has them as remote callable tools.
 */

import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { chatModel } from "./providers/openrouter";
import { runLayoutAgent } from "./layout-agent";
import { runContentAgent } from "./content-agent";
import type { AgentToolCtx } from "./tools";
import { snapshotToPrompt } from "./server-snapshot";

const ORCH_SYSTEM = `you are the microbots stage manager. you control a desktop
of floating windows for a startup founder. you NEVER write more than one short
sentence to the user. lowercase, no emojis, no marketing voice.

you have two sub-agents:
- delegate_layout(intent) — opens/closes/moves/arranges windows on the canvas.
  invoke any time the user's request would benefit from a different window
  arrangement (open new, focus, side-by-side, full-screen one).
- delegate_content(intent) — pushes cards, highlights elements, explains,
  drafts, calls graph tools. invoke when the user asks about content INSIDE a
  window or wants information surfaced.

you can call them in parallel in the same turn. prefer that over sequencing.

after delegating (or skipping delegation), write at most one short sentence
of reply text to the user. that text is streamed as the visible response.

rules:
- if the user just says "hi" or has no clear intent, delegate_layout("open
  the morning brief") and reply briefly.
- never describe what you did in detail. one sentence max. lowercase.
- if you don't need a sub-agent, don't call it. don't call sub-agents with
  vague intents — be specific.
- never claim to have done something a tool didn't do.

at most 3 steps total. snappy.`;

export interface OrchestrateInput {
  ctx: AgentToolCtx;
  query: string;
}

/** Returns a Vercel AI SDK `streamText` result whose `textStream` is
 *  the orchestrator's user-facing reply. The caller is responsible for
 *  iterating that stream and emitting `reply.chunk` events. Tool side
 *  effects flow through `ctx.emit` as they fire. */
export function runOrchestrator({ ctx, query }: OrchestrateInput) {
  const tools = {
    delegate_layout: tool({
      description:
        "Hand off to the layout sub-agent. Use whenever the user wants windows opened, closed, moved, focused, or rearranged.",
      inputSchema: z.object({ intent: z.string().min(1).max(200) }),
      execute: async ({ intent }) => {
        ctx.emit({ type: "agent.delegate", to: "layout", intent });
        return runLayoutAgent(ctx, intent);
      },
    }),
    delegate_content: tool({
      description:
        "Hand off to the content sub-agent. Use when the user asks for facts, drafts, comparisons, or actions inside a window (highlight, focus a graph node, etc).",
      inputSchema: z.object({ intent: z.string().min(1).max(200) }),
      execute: async ({ intent }) => {
        ctx.emit({ type: "agent.delegate", to: "content", intent });
        return runContentAgent(ctx, intent);
      },
    }),
  };

  return streamText({
    model: chatModel(),
    system: ORCH_SYSTEM,
    prompt: `${snapshotToPrompt(ctx.snapshot)}

user said: ${query}`,
    tools,
    stopWhen: stepCountIs(3),
    temperature: 0.3,
  });
}
