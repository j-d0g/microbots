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
import { snapshotToPrompt } from "./server-snapshot";

const CONTENT_SYSTEM = `you are the CONTENT sub-agent for the microbots canvas.
your job is to surface relevant content inside windows the user is looking at.

vocabulary:
- push_card(kind, text, confidence?, ttl?) — surface a transient card
    kinds: memory | entity | source | diff | toast
- highlight(target, window_kind?) — spotlight an element
- explain(topic, depth?) — drop an explanation card
- compare(a, b) — side-by-side
- draft(topic) — surface a generated draft as a diff card
- graph_focus_node(node_id) — center the graph on a node
- graph_zoom_fit() — reset graph viewport
- graph_select(node_id) — open node inspector (empty string closes)
- graph_neighbors(node_id) — highlight 1-hop subgraph
- graph_path(from, to) — show shortest path between two nodes
- graph_filter_layer(layer) — filter to one ontology layer
- graph_filter_integration(integration) — filter to one integration
- graph_search(query) — substring filter; empty clears
- graph_clear() — clear all graph filters/highlights

rules:
- never write prose. only call tools.
- if the user's intent is purely about layout, no-op.
- if the graph window isn't open and you need it, the graph tools will
  open it for you — don't call open_window yourself.
- toast cards must have a ttl (4000–6500). memory/entity cards default to 6000.
- never speculate; only surface facts the snapshot or the user implied.

at most 4 steps. be decisive.`;

export async function runContentAgent(
  ctx: AgentToolCtx,
  intent: string,
): Promise<string> {
  const result = streamText({
    model: chatModel(),
    system: CONTENT_SYSTEM,
    prompt: `${snapshotToPrompt(ctx.snapshot)}

intent: ${intent}`,
    tools: { ...contentTools(ctx), ...graphTools(ctx) },
    stopWhen: stepCountIs(4),
    temperature: 0.3,
  });

  for await (const _chunk of result.textStream) {
    void _chunk;
  }

  return `content-agent finished.`;
}
