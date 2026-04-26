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

import { streamText } from "ai";
import { chatModel } from "./providers/openrouter";
import { contentTools, graphTools, type AgentToolCtx } from "./tools";
import { activeWindowTools, pickRelevantKinds } from "./window-tools";
import { snapshotToPrompt } from "./server-snapshot";
import type { RoomKind } from "@/lib/store";

const BASE_CAP = 3;
const MAX_BONUS = 2;
const HARD_CEILING = 6;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptiveStopCondition(ctx: AgentToolCtx): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ({ steps }: { steps: any[] }) => {
    let failures = 0;
    for (const step of steps) {
      for (const tr of step.toolResults ?? []) {
        const msg = typeof tr.result === "string" ? tr.result : "";
        if (msg.includes("fail") || msg.includes("No window matched") || msg.toLowerCase().includes("unknown") || msg.includes("needs an existing window")) {
          failures++;
        }
      }
    }
    const bonus = Math.min(failures, MAX_BONUS);
    const effectiveCap = Math.min(BASE_CAP + bonus, HARD_CEILING);
    if (bonus > 0 && steps.length === BASE_CAP) {
      ctx.emit({ type: "agent.tool.retry", bonus, effectiveCap });
    }
    return steps.length >= effectiveCap;
  };
}

const BASE_SYSTEM = `CONTENT sub-agent. surface content inside windows. NEVER write prose — tools only.

tools: push_card(kind,text,ttl?) · highlight(target) · explain(topic) · compare(a,b) · draft(topic)
graph: graph_focus_node · graph_zoom_fit · graph_select · graph_neighbors · graph_path · graph_filter_layer · graph_filter_integration · graph_search · graph_clear

rules: no prose. prefer per-window tools over generic. toast ttl 4000-6500. no speculation.

at most 3 steps. decisive.`;

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
    prompt: `${snapshotToPrompt(ctx.snapshot, { includeGrid: false })}

intent: ${intent}`,
    tools: {
      ...contentTools(ctx),
      ...graphTools(ctx),
      ...activeWindowTools(ctx, intent),
    },
    stopWhen: adaptiveStopCondition(ctx),
    temperature: 0.2,
  });

  await result.steps;

  return `content-agent finished.`;
}
