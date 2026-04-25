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
- delegate_layout(intent) — opens/closes/moves/arranges windows. ALSO does
  free-form sizing via set_window_rect, so you can ask for things like
  "spotlight the brief, demote the others to pip corners".
- delegate_content(intent) — pushes cards, highlights elements, explains,
  drafts, calls per-window tools (brief_approve, workflow_select, graph_*,
  stack_filter, etc.). invoke when the user asks about content INSIDE a
  window or wants information surfaced.

YOU SHOULD ALMOST ALWAYS DELEGATE LAYOUT. the canvas should feel alive:
windows shift to put what was just discussed at the visual center. heuristic:

- user mentions a specific window by name or topic → delegate_layout("put
  the {kind} forward; demote others to pip-br / pip-tr") AND
  delegate_content("{their actual ask}") in PARALLEL.
- user asks for content in a kind that isn't open → still delegate_layout
  with intent like "open the {kind} as the subject and tile any open
  context windows". the layout-agent will handle opening + arranging.
- user asks for a clean slate / "reset" → delegate_layout with that intent.
- only skip layout when the user is purely informational (e.g. "what is X?"
  with no window context) AND no relevant window is open.

call sub-agents in parallel in the same turn whenever both are needed —
they share the snapshot and never collide.

after delegating, write at most one short sentence of reply text to the
user. that text streams as the visible response.

rules:
- if the user just says "hi" or has no clear intent, delegate_layout("open
  the morning brief as subject") and reply briefly.
- never describe what you did in detail. one sentence max. lowercase.
- never call sub-agents with vague intents — be specific.
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
