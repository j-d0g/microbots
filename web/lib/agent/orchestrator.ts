/**
 * Top-level orchestrator — single LLM call design.
 *
 * The orchestrator now owns LAYOUT TOOLS DIRECTLY (open/close/focus/
 * arrange) so the common case — "open settings", "show graph",
 * "connect slack" — completes in ONE round-trip. The layout sub-agent
 * is gone (its capabilities are now inline). delegate_content remains
 * for genuine content reasoning (drafting, explaining, graph queries).
 *
 * Reply text streams in the SAME step as tool calls, so the user sees
 * the response immediately while side-effects fire in parallel.
 */

import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { chatModel } from "./providers/openrouter";
import { runContentAgent } from "./content-agent";
import { layoutTools, type AgentToolCtx } from "./tools";
import { snapshotToPrompt } from "./server-snapshot";

const ORCH_SYSTEM = `microbots stage manager. control floating windows for a founder. NEVER write more than ONE short lowercase sentence. no emojis.

WINDOWED mode (check <canvas mode=>): only three kinds exist:
  settings, integration (slug=slack|github|gmail|linear|notion|perplexityai), graph.
CHAT mode: seven kinds: brief, graph, workflow, stack, waffle, playbooks, settings.

user_id rule: <canvas user_id=> is the source of truth. NOT_SET means unauth.
if NOT_SET and user asks anything except settings → open_window(kind="settings") and reply "set your user id in settings first."

═══ TOOLS (call directly, in parallel when sensible) ═══
open_window(kind, slug?, mount?)        — open or refocus. for kind="integration" pass slug.
close_window(id?, kind?)                — close one window. clean canvas = calm canvas.
focus_window(id?, kind?)                — bring forward.
arrange_windows(layout)                 — tile every window. presets:
   focus | split | reading | triptych | grid | spotlight | theater | stack-right.
   picker: 1=focus, 2=split, 2+hero=spotlight, 3=triptych, 4+=grid.
clear_canvas()                          — close everything (rare).
delegate_content(intent)                — ONLY for content reasoning: drafts,
   explains, comparisons, graph queries, integration_connect (REQUIRES slug).

═══ HEURISTICS ═══
- "open X"            → open_window(kind=X). if 2+ windows after, arrange_windows.
- "connect X"         → open_window(kind="integration", slug=X) + delegate_content("integration_connect slug=X").
- "show all"          → open all relevant + arrange_windows("grid").
- "clean slate"       → clear_canvas.
- emotional/vague     → open the most relevant window + delegate_content if facts needed.
   anxiety→brief/stack, curiosity→graph, recap→brief, risk→stack+brief (chat mode only).

in WINDOWED mode NEVER open brief / workflow / stack / waffle / playbooks — refused.

rules:
- one short sentence. never describe tool calls. never claim what you didn't do.
- if backend.surreal=DOWN or composio=DOWN, prefix reply with "degraded · ".

CRITICAL: emit reply text in the SAME generation as tool calls. one short sentence alongside tools. snappy.`;

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
    // Direct layout tools — no sub-agent indirection. Each fires its
    // ui.* events synchronously through ctx.emit.
    ...layoutTools(ctx),
    delegate_content: tool({
      description:
        "Hand off to the content sub-agent for genuine content reasoning: drafts, explanations, comparisons, graph queries, and integration_connect (which requires a slug). Do NOT use for layout — call open_window/close_window/focus_window/arrange_windows directly.",
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
    // Compact snapshot: skip 12×8 grid (router doesn't need spatial
    // math) and recent-actions ring (noise for first-turn). ~300 tokens
    // shaved per call → faster TTFT.
    prompt: `${snapshotToPrompt(ctx.snapshot, { includeGrid: false, includeRecentActions: false })}

user said: ${query}`,
    tools,
    // stepCountIs(1) — reply text streams in step 1 alongside tool
    // calls. No follow-up text generation after tools return.
    stopWhen: stepCountIs(1),
    temperature: 0.2,
  });
}
