/**
 * Graph window tool registry.
 *
 * Per-window tools for the graph canvas visualization. These tools allow
 * the UI agent to manipulate the knowledge graph view: focus nodes, zoom,
 * filter, highlight paths, and read the current graph state.
 *
 * The graph shows nodes of types: user, integration, entity, memory, skill, workflow.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";
import type { AgentToolCtx } from "../tools";

/* ------------------------------------------------------------------ *
 *  Schemas
 * ------------------------------------------------------------------ */

/** Node types in the knowledge graph */
const NODE_TYPE = z.enum([
  "user",
  "integration",
  "entity",
  "memory",
  "skill",
  "workflow",
]);

/** Valid integration slugs for filtering */
const INTEGRATION_SLUG = z.enum([
  "slack",
  "github",
  "linear",
  "gmail",
  "notion",
  "perplexity",
]);

/** Graph layers that can be filtered */
const GRAPH_LAYER = z.enum([
  "user",
  "integration",
  "entity",
  "memory",
  "skill",
  "workflow",
]);

/* ------------------------------------------------------------------ *
 *  Helper functions
 * ------------------------------------------------------------------ */

/** Build UI events for graph tool dispatch.
 *  Ensures the graph window is open before dispatching the tool event. */
function buildGraphEvents(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
): AgentEvent[] {
  const ensureGraph = ctx.snapshot.windows.some((w) => w.kind === "graph")
    ? []
    : [{ type: "ui.room" as const, room: "graph" as WindowKind }];

  return [
    ...ensureGraph,
    { type: "ui.tool" as const, room: "graph" as WindowKind, tool: toolName, args },
  ];
}

/** Apply tool to snapshot and emit events.
 *  Emits tool start, all UI events, applies to snapshot, emits tool done. */
function applyAndEmit(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
  uiEvents: AgentEvent[],
): string {
  ctx.emit({ type: "agent.tool.start", name: toolName, args });
  for (const e of uiEvents) ctx.emit(e);
  const result = applyToolToSnapshot(ctx.snapshot, toolName, args);
  ctx.snapshot = result.snapshot;
  ctx.emit({ type: "agent.tool.done", name: toolName, ok: (result.ok ?? true) });
  return result.message;
}

/* ------------------------------------------------------------------ *
 *  Graph Window Tools
 * ------------------------------------------------------------------ */

export function graphWindowTools(ctx: AgentToolCtx) {
  return {
    /** Center and zoom to a specific node by ID */
    graph_focus_node: tool({
      description:
        "Center and zoom to a specific node in the graph. Pass node_id like 'user-maya', 'ent-product-bugs', 'wf-bug-triage', 'mem-abc123', 'skill-research', 'integration-slack'.",
      inputSchema: z.object({
        node_id: z.string().min(1, "Node ID is required"),
      }),
      execute: async ({ node_id }) => {
        const events = buildGraphEvents(ctx, "focus_node", { node_id });
        return applyAndEmit(ctx, "graph_focus_node", { node_id }, events);
      },
    }),

    /** Reset viewport to fit all visible nodes */
    graph_zoom_fit: tool({
      description:
        "Reset the graph viewport to fit all visible nodes. Use after exploring a specific node to return to overview.",
      inputSchema: z.object({}),
      execute: async () => {
        const events = buildGraphEvents(ctx, "zoom_fit", {});
        return applyAndEmit(ctx, "graph_zoom_fit", {}, events);
      },
    }),

    /** Open node inspector panel for a node (empty string to close) */
    graph_select: tool({
      description:
        "Open the node inspector panel for a specific node. Pass node_id to inspect, or empty string to close the inspector.",
      inputSchema: z.object({
        node_id: z.string(),
      }),
      execute: async ({ node_id }) => {
        const events = buildGraphEvents(ctx, "select", { node_id });
        const action = node_id ? `Selected node ${node_id}` : "Closed node inspector";
        return applyAndEmit(ctx, "graph_select", { node_id }, events);
      },
    }),

    /** Highlight node and 1-hop neighbors, fade others */
    graph_neighbors: tool({
      description:
        "Highlight a node and its 1-hop neighbors (directly connected nodes). Other nodes are faded. Useful for exploring local context around a node.",
      inputSchema: z.object({
        node_id: z.string().min(1, "Node ID is required"),
      }),
      execute: async ({ node_id }) => {
        const events = buildGraphEvents(ctx, "neighbors", { node_id });
        return applyAndEmit(ctx, "graph_neighbors", { node_id }, events);
      },
    }),

    /** Highlight node and direct neighbors (no zoom change) */
    graph_highlight: tool({
      description:
        "Highlight a node and its direct neighbors without changing the zoom level. Pass empty string to clear all highlights.",
      inputSchema: z.object({
        node_id: z.string(),
      }),
      execute: async ({ node_id }) => {
        const events = buildGraphEvents(ctx, "highlight", { node_id });
        const action = node_id
          ? `Highlighted ${node_id} and neighbors`
          : "Cleared highlights";
        return applyAndEmit(ctx, "graph_highlight", { node_id }, events);
      },
    }),

    /** Set zoom level (0.2=far/overview to 4=close/detail) */
    graph_zoom_to: tool({
      description:
        "Set the graph zoom level. Use 0.2-0.5 for overview, 1.0 for normal, 2-4 for detail. Range: 0.2 (far) to 4 (close).",
      inputSchema: z.object({
        scale: z.number().min(0.2).max(4).describe("Zoom scale: 0.2=overview, 1=normal, 4=detail"),
      }),
      execute: async ({ scale }) => {
        const events = buildGraphEvents(ctx, "zoom_to", { scale });
        return applyAndEmit(ctx, "graph_zoom_to", { scale }, events);
      },
    }),

    /** Highlight shortest path between two nodes */
    graph_path: tool({
      description:
        "Highlight the shortest path between two nodes. Useful for tracing relationships or finding connections between entities.",
      inputSchema: z.object({
        from: z.string().min(1, "Source node ID is required"),
        to: z.string().min(1, "Target node ID is required"),
      }),
      execute: async ({ from, to }) => {
        const events = buildGraphEvents(ctx, "path", { from, to });
        return applyAndEmit(ctx, "graph_path", { from, to }, events);
      },
    }),

    /** Filter to a specific layer (empty clears filter) */
    graph_filter_layer: tool({
      description:
        "Filter the graph to show only nodes of a specific layer/type. Layers: user, integration, entity, memory, skill, workflow. Pass empty string to clear the filter.",
      inputSchema: z.object({
        layer: z.string(),
      }),
      execute: async ({ layer }) => {
        const events = buildGraphEvents(ctx, "filter_layer", { layer });
        const action = layer
          ? `Filtered to ${layer} layer`
          : "Cleared layer filter";
        return applyAndEmit(ctx, "graph_filter_layer", { layer }, events);
      },
    }),

    /** Filter to nodes related to one integration */
    graph_filter_integration: tool({
      description:
        "Filter the graph to show only nodes related to a specific integration. Valid integrations: slack, github, linear, gmail, notion, perplexity.",
      inputSchema: z.object({
        integration: z.string().min(1, "Integration slug is required"),
      }),
      execute: async ({ integration }) => {
        const events = buildGraphEvents(ctx, "filter_integration", { integration });
        return applyAndEmit(ctx, "graph_filter_integration", { integration }, events);
      },
    }),

    /** Filter nodes by label substring (empty clears) */
    graph_search: tool({
      description:
        "Search and filter nodes by label substring. Shows only nodes whose labels contain the query string. Pass empty string to clear the search filter.",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => {
        const events = buildGraphEvents(ctx, "search", { query });
        const action = query
          ? `Searched for "${query}"`
          : "Cleared search filter";
        return applyAndEmit(ctx, "graph_search", { query }, events);
      },
    }),

    /** Clear all filters, highlights, paths, and selection */
    graph_clear: tool({
      description:
        "Clear all graph filters, highlights, paths, and selection. Returns the graph to its default unfiltered state.",
      inputSchema: z.object({}),
      execute: async () => {
        const events = buildGraphEvents(ctx, "clear", {});
        return applyAndEmit(ctx, "graph_clear", {}, events);
      },
    }),

    /** Read the current graph state */
    graph_read_state: tool({
      description:
        "Read the current graph state including visible nodes, selected node, zoom level, and active filters. Does not modify the graph.",
      inputSchema: z.object({}),
      execute: async () => {
        // Find the graph window and extract its state from the snapshot
        const graphWindow = ctx.snapshot.windows.find((w) => w.kind === "graph");
        
        if (!graphWindow) {
          return "Graph window is not open. Open it first with open_window(kind='graph').";
        }

        // Emit tool start/done for consistency
        ctx.emit({ type: "agent.tool.start", name: "graph_read_state", args: {} });

        ctx.emit({ type: "agent.tool.done", name: "graph_read_state", ok: true });

        const lines: string[] = [];
        lines.push("Current graph state:");
        lines.push(`  Window: ${graphWindow.id} (${graphWindow.mount})`);
        lines.push(`  Focused: ${graphWindow.focused}`);
        lines.push(`  Z-index: ${graphWindow.zIndex}`);

        return lines.join("\n");
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Type exports
 * ------------------------------------------------------------------ */

export type GraphWindowToolBag = ReturnType<typeof graphWindowTools>;
