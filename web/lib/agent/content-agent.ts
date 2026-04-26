/**
 * Content sub-agent.
 *
 * Owns "what does the user need to see/know inside a window" — pushing
 * floating cards, calling per-window tools (graph_focus_node and
 * friends), highlighting, drafting, comparing.
 *
 * Same shape as the layout-agent: short system prompt, ≤ 3 steps, no
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
- integration_connect(slug) — kick off Composio OAuth for one toolkit.
  ONLY call when user_id is set (check the snapshot). slugs: slack,
  github, gmail, linear, notion, perplexityai.

graph window tools (always available — open the graph if needed):
- graph_focus_node, graph_zoom_fit, graph_select, graph_neighbors,
  graph_path, graph_filter_layer, graph_filter_integration,
  graph_search, graph_clear

rules:
- never write prose. only call tools.
- if the user's intent is purely about layout, no-op.
- toast cards must have a ttl (4000–6500). memory/entity cards default to 6000.
- never speculate; only surface facts the snapshot or the user implied.
- in WINDOWED mode (canvas mode=windowed), the only per-window tools
  available are graph_* and integration_connect — DO NOT call brief_*,
  workflow_*, stack_*, waffle_*, playbooks_*, settings_*. those rooms
  do not exist in this mode.
- if the user asks to connect a toolkit but user_id is NOT_SET, do
  NOT call integration_connect. delegate the layout-agent to surface
  settings instead (already handled by the orchestrator).

at most 3 steps. be decisive.`;

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
    "settings_set_user_id, settings_clear_user_id, settings_refresh_health",
  integration:
    "integration_connect, integration_refresh, integration_cancel — pass slug for the matching window",
};

function buildSystemPrompt(openKinds: RoomKind[], mode: "windowed" | "chat"): string {
  if (openKinds.length === 0) return BASE_SYSTEM;
  // In windowed mode the only valid per-window tool families are
  // settings_* and integration_*; everything else is hidden.
  const visible =
    mode === "windowed"
      ? openKinds.filter((k) => k === "settings" || k === "integration")
      : openKinds.filter((k) => k !== "graph");
  if (visible.length === 0) return BASE_SYSTEM;
  const lines = visible.map((k) => `  · ${k}: ${PER_WINDOW_HINT[k]}`);
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
  const mode = ctx.snapshot.ui?.mode ?? "windowed";

  const result = streamText({
    model: chatModel(),
    system: buildSystemPrompt(relevantKinds, mode),
    prompt: `${snapshotToPrompt(ctx.snapshot)}

intent: ${intent}`,
    tools: {
      ...contentTools(ctx),
      ...graphTools(ctx),
      ...activeWindowTools(ctx, intent),
    },
    stopWhen: stepCountIs(3),
    temperature: 0.2,
  });

  await result.steps;

  return `content-agent finished.`;
}
