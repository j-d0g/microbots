/**
 * Zod-typed tool surface for the orchestrator + sub-agents.
 *
 * Three buckets:
 *   - LAYOUT_TOOLS — handed to the layout-agent. Mutate window state.
 *   - CONTENT_TOOLS — handed to the content-agent. Push cards, dispatch
 *     verbs, stream text.
 *   - WINDOW_TOOLS — handed to the content-agent. Per-window MCP-style
 *     tools (currently graph-window only; teammates extend per-kind).
 *
 * Each tool's `execute()` receives a shared `AgentToolCtx` that owns the
 * mutable server-side snapshot and an event sink the route reads to
 * forward SSE events to the browser. The agent's view of state is kept
 * fresh by `applyToolToSnapshot()`.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "./server-snapshot";
import type { CanvasSnapshot, MountPoint } from "./types";
import type { AgentEvent } from "@/lib/agent-client";
import type { RoomKind } from "@/lib/store";

/* ------------------------------------------------------------------ *
 *  Shared context
 * ------------------------------------------------------------------ */

/** State shared across every tool invocation in a single agent request.
 *  The route owns this and passes it into the tool factories.
 *
 *  `emit` writes directly to the SSE response so events reach the
 *  browser the moment a tool fires, with no buffering. Tools must NOT
 *  touch the underlying controller — `emit` keeps that boundary clean. */
export interface AgentToolCtx {
  snapshot: CanvasSnapshot;
  emit: (event: AgentEvent) => void;
}

/** Helper that emits the tool-start chip, the underlying UI events,
 *  mutates the server-side snapshot mirror, and emits tool-done. The
 *  return string is what the agent sees as the tool's result on its
 *  next step. */
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
  ctx.emit({ type: "agent.tool.done", name: toolName, ok: true });
  return result.message;
}

/* ------------------------------------------------------------------ *
 *  Enums (Zod) mirroring the TS unions
 * ------------------------------------------------------------------ */

export const WINDOW_KIND = z.enum([
  "brief",
  "graph",
  "workflow",
  "stack",
  "waffle",
  "playbooks",
  "settings",
]);

export const MOUNT_POINT = z.enum([
  "full",
  "left-half",
  "right-half",
  "top-half",
  "bottom-half",
  "left-third",
  "center-third",
  "right-third",
  "tl",
  "tr",
  "bl",
  "br",
  "pip-br",
  "pip-tr",
]);

export const LAYOUT_PRESET = z.enum([
  "focus",
  "split",
  "grid",
  "stack-right",
]);

export const CARD_KIND = z.enum([
  "memory",
  "entity",
  "source",
  "diff",
  "toast",
]);

/* ------------------------------------------------------------------ *
 *  Layout tools
 * ------------------------------------------------------------------ */

export function layoutTools(ctx: AgentToolCtx) {
  return {
    open_window: tool({
      description:
        "Open a window of a given kind at a named mount point. If the window is already open, brings it forward and re-mounts it. Use 'full' if no other constraint.",
      inputSchema: z.object({
        kind: WINDOW_KIND,
        mount: MOUNT_POINT.optional().default("full"),
      }),
      execute: async ({ kind, mount }) => {
        const events: AgentEvent[] = [
          { type: "ui.room", room: kind as RoomKind },
        ];
        return applyAndEmit(ctx, "open_window", { kind, mount }, events);
      },
    }),

    close_window: tool({
      description:
        "Close a window. Pass `id` if you have it; otherwise pass `kind` to close the most recent of that type.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ id, kind }) => {
        const events: AgentEvent[] = [
          { type: "ui.close_window", room: kind as RoomKind | undefined },
        ];
        return applyAndEmit(ctx, "close_window", { id, kind }, events);
      },
    }),

    move_window: tool({
      description:
        "Move/snap an existing window to a new mount point. Identify it by `id` (preferred) or `kind`.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
        mount: MOUNT_POINT,
      }),
      execute: async ({ id, kind, mount }) => {
        // Translate the named mount into a % rect on the client side
        // by emitting a `ui.resize` with the right rect. The browser
        // applies it via updateWindowRect.
        const rect = mountToClientRect(mount);
        const events: AgentEvent[] = [
          { type: "ui.resize", room: kind as RoomKind | undefined, rect },
        ];
        return applyAndEmit(ctx, "move_window", { id, kind, mount }, events);
      },
    }),

    focus_window: tool({
      description:
        "Bring a window to the foreground. Identify by id or kind.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ id, kind }) => {
        // The client's bringToFront mutates z; we don't have a dedicated
        // event, so we re-open the kind which the store treats as a
        // bring-to-front when the window already exists.
        const events: AgentEvent[] = kind
          ? [{ type: "ui.room", room: kind as RoomKind }]
          : [];
        return applyAndEmit(ctx, "focus_window", { id, kind }, events);
      },
    }),

    arrange_windows: tool({
      description:
        "Tile every open window using a preset. focus=top maximised; split=two side by side; grid=tile all; stack-right=main left + sidebar right. Call this when 2+ windows are open and the user asks for an arrangement.",
      inputSchema: z.object({ layout: LAYOUT_PRESET }),
      execute: async ({ layout }) => {
        const events: AgentEvent[] = [{ type: "ui.arrange", layout }];
        return applyAndEmit(ctx, "arrange_windows", { layout }, events);
      },
    }),

    clear_canvas: tool({
      description:
        "Close every open window. Use sparingly — only when the user explicitly asks for a clean slate.",
      inputSchema: z.object({}),
      execute: async () => {
        // Client emits one ui.close_window per existing window.
        const events: AgentEvent[] = ctx.snapshot.windows.map((w) => ({
          type: "ui.close_window",
          room: w.kind as RoomKind,
        }));
        return applyAndEmit(ctx, "clear_canvas", {}, events);
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Content tools (cards, verbs, speech)
 * ------------------------------------------------------------------ */

export function contentTools(ctx: AgentToolCtx) {
  return {
    push_card: tool({
      description:
        "Surface a transient floating card. Use sparingly. memory=recalled fact with confidence; entity=reference to a person/integration; toast=status flash.",
      inputSchema: z.object({
        kind: CARD_KIND,
        text: z.string().min(1).max(180),
        confidence: z.number().min(0).max(1).optional(),
        ttl: z.number().int().positive().max(30000).optional(),
      }),
      execute: async ({ kind, text, confidence, ttl }) => {
        const id = `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const events: AgentEvent[] = [
          {
            type: "ui.card",
            card: {
              id,
              kind,
              data: confidence !== undefined ? { text, confidence } : { text },
              ttl,
            },
          },
        ];
        return applyAndEmit(ctx, "push_card", { kind, text, confidence, ttl }, events);
      },
    }),

    highlight: tool({
      description:
        "Spotlight an element inside a window — e.g. a node in the graph, a row in the brief.",
      inputSchema: z.object({
        target: z.string(),
        window_kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ target, window_kind }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.verb",
            verb: "highlight",
            args: { target, window_kind },
          },
        ];
        return applyAndEmit(ctx, "highlight", { target, window_kind }, events);
      },
    }),

    explain: tool({
      description: "Drop an inline explanation card next to the named target.",
      inputSchema: z.object({
        topic: z.string(),
        depth: z.enum(["brief", "detailed"]).optional(),
      }),
      execute: async ({ topic, depth }) => {
        const events: AgentEvent[] = [
          { type: "ui.verb", verb: "explain", args: { target: topic, depth } },
        ];
        return applyAndEmit(ctx, "explain", { topic, depth }, events);
      },
    }),

    compare: tool({
      description: "Show a side-by-side comparison of two named items.",
      inputSchema: z.object({ a: z.string(), b: z.string() }),
      execute: async ({ a, b }) => {
        const events: AgentEvent[] = [
          { type: "ui.verb", verb: "compare", args: { a, b } },
        ];
        return applyAndEmit(ctx, "compare", { a, b }, events);
      },
    }),

    draft: tool({
      description: "Surface a draft (email, PR description, weekly update) as a diff card.",
      inputSchema: z.object({ topic: z.string() }),
      execute: async ({ topic }) => {
        const id = `draft-${Date.now()}`;
        const events: AgentEvent[] = [
          {
            type: "ui.card",
            card: {
              id,
              kind: "diff",
              data: { text: `Draft ready · ${topic}`, confidence: 0.86 },
              ttl: 6500,
            },
          },
        ];
        return applyAndEmit(ctx, "draft", { topic }, events);
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Window-specific tools (per-kind, agent calls them via the room
 *  tool dispatcher in lib/room-tools.ts on the client). For now,
 *  graph-only — teammates extend per kind.
 * ------------------------------------------------------------------ */

export function graphTools(ctx: AgentToolCtx) {
  // Helper: graph tools require the graph window to be open. If it
  // isn't, we open it first as part of the same tool emission.
  const ensureGraph = (): AgentEvent[] =>
    ctx.snapshot.windows.some((w) => w.kind === "graph")
      ? []
      : [{ type: "ui.room", room: "graph" }];

  const dispatch = (toolName: string, args: Record<string, unknown>): string => {
    const events: AgentEvent[] = [
      ...ensureGraph(),
      { type: "ui.tool", room: "graph", tool: toolName, args },
    ];
    return applyAndEmit(ctx, `graph_${toolName}`, args, events);
  };

  return {
    graph_focus_node: tool({
      description:
        "Center the memory graph on a node and zoom in. Pass node_id like 'user-maya', 'ent-product-bugs', 'wf-bug-triage'.",
      inputSchema: z.object({ node_id: z.string() }),
      execute: async ({ node_id }) => dispatch("focus_node", { node_id }),
    }),
    graph_zoom_fit: tool({
      description: "Reset the graph viewport to fit all visible nodes.",
      inputSchema: z.object({}),
      execute: async () => dispatch("zoom_fit", {}),
    }),
    graph_select: tool({
      description:
        "Open the node inspector panel for a node. Pass an empty string to close.",
      inputSchema: z.object({ node_id: z.string() }),
      execute: async ({ node_id }) => dispatch("select", { node_id }),
    }),
    graph_neighbors: tool({
      description:
        "Highlight a node and its 1-hop neighbors. Other nodes fade.",
      inputSchema: z.object({ node_id: z.string() }),
      execute: async ({ node_id }) => dispatch("neighbors", { node_id }),
    }),
    graph_path: tool({
      description: "Highlight the shortest path between two nodes.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: async ({ from, to }) => dispatch("path", { from, to }),
    }),
    graph_filter_layer: tool({
      description:
        "Filter the graph to a layer (user, integration, entity, memory, skill, workflow). Empty/all clears.",
      inputSchema: z.object({ layer: z.string() }),
      execute: async ({ layer }) => dispatch("filter_layer", { layer }),
    }),
    graph_filter_integration: tool({
      description:
        "Filter to nodes related to one integration (slack, github, linear, gmail, notion, perplexity).",
      inputSchema: z.object({ integration: z.string() }),
      execute: async ({ integration }) =>
        dispatch("filter_integration", { integration }),
    }),
    graph_search: tool({
      description: "Filter nodes by label substring. Empty clears.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => dispatch("search", { query }),
    }),
    graph_clear: tool({
      description: "Clear all graph filters, highlights, paths, and selection.",
      inputSchema: z.object({}),
      execute: async () => dispatch("clear", {}),
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  helpers
 * ------------------------------------------------------------------ */

/** Translate a named mount to a partial pixel rect the client's
 *  `updateWindowRect` understands. The client uses pixel rects, not %,
 *  so we translate at the boundary. The %-rect → px-rect math is
 *  conservative and the user's `arrangeWindows()` is the source of
 *  truth for "tight" mounts. We keep it %-only here and let the client
 *  multiply by viewport. The fact that we send `x/y/w/h` as fractions
 *  of a 100×100 grid relies on `updateWindowRect` not interpreting
 *  them as pixels — which it does. So we instead emit the rect keyed
 *  to a 1440×900 reference so the user's display feels right. */
function mountToClientRect(
  mount: MountPoint,
): { x?: number; y?: number; w?: number; h?: number } {
  // Reference viewport for client-side rect math. 1440×900 is a common
  // laptop default; the client clamps to its actual viewport on apply.
  const VW = 1440;
  const VH = 820; // 900 - 80 dock
  const m = mountRectPctLocal(mount);
  return {
    x: Math.round((m.x / 100) * VW),
    y: Math.round((m.y / 100) * VH),
    w: Math.round((m.w / 100) * VW),
    h: Math.round((m.h / 100) * VH),
  };
}

function mountRectPctLocal(mount: MountPoint) {
  switch (mount) {
    case "full":         return { x: 0,  y: 0,   w: 100,    h: 100 };
    case "left-half":    return { x: 0,  y: 0,   w: 50,     h: 100 };
    case "right-half":   return { x: 50, y: 0,   w: 50,     h: 100 };
    case "top-half":     return { x: 0,  y: 0,   w: 100,    h: 50 };
    case "bottom-half":  return { x: 0,  y: 50,  w: 100,    h: 50 };
    case "left-third":   return { x: 0,  y: 0,   w: 100/3,  h: 100 };
    case "center-third": return { x: 100/3, y: 0, w: 100/3, h: 100 };
    case "right-third":  return { x: 200/3, y: 0, w: 100/3, h: 100 };
    case "tl":           return { x: 0,  y: 0,   w: 50,     h: 50 };
    case "tr":           return { x: 50, y: 0,   w: 50,     h: 50 };
    case "bl":           return { x: 0,  y: 50,  w: 50,     h: 50 };
    case "br":           return { x: 50, y: 50,  w: 50,     h: 50 };
    case "pip-br":       return { x: 75, y: 70,  w: 25,     h: 30 };
    case "pip-tr":       return { x: 75, y: 0,   w: 25,     h: 30 };
    case "freeform":     return { x: 25, y: 15,  w: 50,     h: 70 };
  }
}

export type LayoutToolBag = ReturnType<typeof layoutTools>;
export type ContentToolBag = ReturnType<typeof contentTools>;
export type GraphToolBag = ReturnType<typeof graphTools>;
