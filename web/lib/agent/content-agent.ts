/**
 * Content sub-agent.
 *
 * Owns "what does the user need to see/know inside a window" — pushing
 * floating cards, calling per-window tools (graph_focus_node and
 * friends), highlighting, drafting, comparing.
 *
 * Same shape as the layout-agent: short system prompt, ≤ 4 steps, no
 * prose. Returns a brief result string the orchestrator can mention.
 */

import { streamText, stepCountIs } from "ai";
import { chatModel } from "./providers/openrouter";
import { contentTools, graphTools, type AgentToolCtx } from "./tools";
import { activeWindowTools, pickRelevantKinds } from "./window-tools";
import { snapshotToPrompt } from "./server-snapshot";
import type { RoomKind } from "@/lib/store";

const BASE_SYSTEM = `you are the CONTENT sub-agent for the microbots canvas.
your job is to surface relevant content inside windows the user is looking at.

general tools (always available):
- push_card(kind, text, confidence?, ttl?) — surface a transient card
    kinds: memory | entity | source | diff | toast
- highlight(target, window_kind?) — spotlight an element
- explain(topic, depth?) — drop an explanation card
- compare(a, b) — side-by-side
- draft(topic) — surface a generated draft as a diff card

graph window tools (always available — open the graph if needed):
- graph_focus_node, graph_zoom_fit, graph_select, graph_neighbors,
  graph_path, graph_filter_layer, graph_filter_integration,
  graph_search, graph_clear

rules:
- never write prose. only call tools.
- if the user's intent is purely about layout, no-op.
- toast cards must have a ttl (4000–6500). memory/entity cards default to 6000.
- never speculate; only surface facts the snapshot or the user implied.
- prefer per-window tools (e.g. brief_approve, workflow_select,
  stack_filter) over generic verbs whenever a matching tool exists.

at most 4 steps. be decisive.`;

const PER_WINDOW_HINT: Record<RoomKind, string> = {
  brief:
    "brief_filter, brief_clear_filters, brief_expand, brief_collapse, brief_approve, brief_defer, brief_scroll_to, brief_highlight",
  graph: "(see graph_* above)",
  workflow:
    "workflow_filter, workflow_clear_filters, workflow_select, workflow_back, workflow_show_dag, workflow_show_recipe, workflow_toggle_view, workflow_scroll_to, workflow_highlight",
  stack:
    "stack_filter, stack_clear_filters, stack_select, stack_deselect, stack_scroll_to, stack_highlight",
  waffle:
    "waffle_set_state, waffle_set_transcript, waffle_append_transcript, waffle_clear_transcript",
  playbooks:
    "playbooks_filter, playbooks_search, playbooks_clear_filters, playbooks_scroll_to, playbooks_highlight, playbooks_try_tonight",
  settings:
    "settings_scroll_to, settings_highlight, settings_filter_integrations, settings_clear_filters",
};

function buildSystemPrompt(openKinds: RoomKind[]): string {
  if (openKinds.length === 0) return BASE_SYSTEM;
  const lines = openKinds
    .filter((k) => k !== "graph")
    .map((k) => `  · ${k}: ${PER_WINDOW_HINT[k]}`);
  if (lines.length === 0) return BASE_SYSTEM;
  return `${BASE_SYSTEM}

per-window tools available right now (only for windows currently open):
${lines.join("\n")}`;
}

export async function runContentAgent(
  ctx: AgentToolCtx,
  intent: string,
): Promise<string> {
  // Pick the per-window tool bag relevant to this intent — keyword
  // match first, fall back to all-open-windows. Same one LLM call,
  // dramatically smaller tool surface.
  const relevantKinds = pickRelevantKinds(ctx.snapshot, intent);

  const result = streamText({
    model: chatModel(),
    system: buildSystemPrompt(relevantKinds),
    prompt: `${snapshotToPrompt(ctx.snapshot)}

intent: ${intent}`,
    tools: {
      ...contentTools(ctx),
      ...graphTools(ctx),
      ...activeWindowTools(ctx, intent),
    },
    stopWhen: stepCountIs(4),
    temperature: 0.3,
  });

  for await (const _chunk of result.textStream) {
    void _chunk;
  }

  return `content-agent finished.`;
}
