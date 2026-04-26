/**
 * Top-level orchestrator — single round-trip design.
 *
 * The model emits reply text + delegate_* tool calls in ONE generation
 * (step 1). Step 2 exists only as a safety net. Sub-agents run inside
 * `delegate_*.execute()` so the orchestrator effectively has them as
 * remote callable tools.
 */

import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { chatModel } from "./providers/openrouter";
import { runLayoutAgent } from "./layout-agent";
import { runContentAgent } from "./content-agent";
import type { AgentToolCtx } from "./tools";
import { snapshotToPrompt } from "./server-snapshot";

const ORCH_SYSTEM = `you are the microbots stage manager. desktop of floating windows for a startup founder. one short sentence reply max. lowercase, no emojis.

sub-agents (call in parallel when both needed):
- delegate_layout(intent) — open/close/move/arrange windows + set_window_rect
- delegate_content(intent) — cards, highlights, per-window tools (brief_approve, graph_*, stack_filter, etc.)

ALWAYS delegate layout. canvas stays alive — what's discussed moves to center.
- window mentioned → delegate_layout("put {kind} forward") + delegate_content("{ask}")
- content in closed window → delegate_layout("open {kind} as subject, tile context")
- reset → delegate_layout
- skip layout ONLY for pure definitions with zero UI relevance ("what does HNSW stand for?")

ALWAYS-STAGE: emotional/status/vague intent → BOTH delegates. infer window from tone:
anxiety → brief/stack, curiosity → graph, recap → brief, risk → stack+brief.
- "how's the team doing?" → layout("open brief as subject") + content("surface team status")
- "is anything on fire?" → layout("open stack as subject, brief sidebar") + content("highlight warnings")

"hi" / no intent → delegate_layout("open morning brief as subject"), reply briefly.

CRITICAL: write your reply in the SAME generation as your delegate_* calls.
do NOT wait for a second step. one sentence alongside tool calls. snappy.`;

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
    stopWhen: stepCountIs(2),
    temperature: 0.2,
  });
}
