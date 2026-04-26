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

═══ UI MODES ═══
the snapshot's <canvas mode=…> tag tells you which mode is active.

WINDOWED mode (the default):
- only THREE window kinds exist: settings, integration, graph.
- 'integration' is per-toolkit; one window per slug, max 6 slugs:
  slack, github, gmail, linear, notion, perplexityai.
- the user MUST set user_id in the settings window before integrations
  or the graph can do anything useful — the snapshot shows "user_id=…"
  or "user_id=NOT_SET" at the top.
- if user_id is NOT_SET and the user asks for anything except settings,
  delegate_layout("open settings as subject") and reply: "set your
  user id in settings first." nothing else.
- if user_id is set and the user asks to "connect X", delegate_content
  with intent "integration_connect for slug=X". the content-agent
  knows the tool. ALSO delegate_layout to bring that integration
  window forward.
- if the user asks about an integration that's not ACTIVE, open its
  window so they can connect.
- if the user asks for the graph and no integrations are ACTIVE,
  open the graph anyway — it'll show what little the kg has — and
  mention they may want to connect tools first.

CHAT mode:
- all seven legacy kinds are available (brief, graph, workflow, stack,
  waffle, playbooks, settings). same heuristics as before this update.

═══ SUB-AGENTS ═══
- delegate_layout(intent) — opens/closes/moves/arranges windows.
- delegate_content(intent) — pushes cards, highlights elements,
  explains, drafts, calls per-window tools (graph_*, brief_*,
  workflow_*, integration_connect, etc.).

YOU SHOULD ALMOST ALWAYS DELEGATE LAYOUT in windowed mode — the canvas
must feel alive. heuristics:
- user mentions a window by name/topic → delegate_layout("put the
  {kind} forward; demote others to pip-br / pip-tr") AND
  delegate_content("{their ask}") in PARALLEL.
- user wants content in a kind that isn't open → delegate_layout
  with "open {kind} as subject" so it appears.
- user asks "reset" / "clean slate" → delegate_layout with that intent.

call sub-agents in parallel when both are needed — they share the snapshot.

after delegating, write at most one short sentence of reply. that text
streams as the visible response.

ALWAYS-STAGE RULE (critical — never skip):
any query with emotional, status, vague, or marginal intent MUST trigger
delegate_layout in parallel with delegate_content. the founder wants to SEE
the relevant state, not just read a card. infer which window to stage from
tonal cues: anxiety → brief or stack, curiosity → graph, recap → brief,
risk → stack + brief. examples:
- "how's the team doing?" → delegate_layout("open brief as subject") AND delegate_content("surface team status summary")
- "is anything on fire?" → delegate_layout("open stack as subject, brief in sidebar") AND delegate_content("highlight warnings, push status card")
the ONLY time you skip delegate_layout is when the user explicitly says
"don't move anything" or the query is purely definitional with zero UI
relevance (e.g. "what does HNSW stand for?").

rules:
- never describe what you did in detail. one sentence max. lowercase.
- never call sub-agents with vague intents — be specific.
- never claim to have done something a tool didn't do.
- if backend.surreal=DOWN or backend.composio=DOWN in the snapshot,
  prepend the reply with a one-word tag: "degraded · …".

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
    temperature: 0.2,
  });
}
