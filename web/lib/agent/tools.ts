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
  ctx.emit({ type: "agent.tool.done", name: toolName, ok: (result.ok ?? true) });
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
  "integration",
]);

/** Toolkit slugs the live Composio account exposes. Hand-mirrored from
 *  `lib/api/backend.ts#TOOLKIT_SLUGS`; if the backend grows another
 *  toolkit, extend both lists. */
export const TOOLKIT_SLUG = z.enum([
  "slack",
  "github",
  "gmail",
  "linear",
  "notion",
  "perplexityai",
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

/** Layout preset names — kept in sync with `LAYOUT_PRESET_NAMES` in
 *  `server-snapshot.ts`. The simulator owns the geometry; this enum
 *  is just the wire shape the agent sees. */
export const LAYOUT_PRESET = z.enum([
  "focus",
  "split",
  "grid",
  "stack-right",
  "spotlight",
  "theater",
  "reading",
  "triptych",
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
        "Open a window of a given kind at a named mount point. If the window is already open, brings it forward and re-mounts it. Use 'full' if no other constraint. For kind='integration' you MUST pass a `slug` (one of: slack, github, gmail, linear, notion, perplexityai) — multiple integration windows can coexist, distinguished by slug. In windowed mode only graph, settings, and integration are openable.",
      inputSchema: z.object({
        kind: WINDOW_KIND,
        mount: MOUNT_POINT.optional().default("full"),
        slug: z.string().optional(),
      }),
      execute: async ({ kind, mount, slug }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.room",
            room: kind as RoomKind,
            payload: slug ? { slug } : undefined,
          },
        ];
        return applyAndEmit(
          ctx,
          "open_window",
          { kind, mount, slug },
          events,
        );
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
        "Move/snap an existing window to a NAMED mount anchor. Identify it by `id` (preferred) or `kind`. For free-form custom positioning, prefer `set_window_rect` instead.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
        mount: MOUNT_POINT,
      }),
      execute: async ({ id, kind, mount }) => {
        const rect = mountToClientRect(mount, ctx.snapshot.viewport);
        const events: AgentEvent[] = [
          { type: "ui.resize", room: kind as RoomKind | undefined, rect },
        ];
        return applyAndEmit(ctx, "move_window", { id, kind, mount }, events);
      },
    }),

    set_window_rect: tool({
      description:
        "Move and resize a window to a custom % rectangle. Use when no named mount fits — e.g. centered subject (x:17, y:10, w:66, h:80), top-strip (x:0, y:0, w:100, h:30), bottom-strip + side, off-canvas drift, etc. Prefer named mounts when they fit; this tool is for organic, asymmetric layouts. Coordinates are 0–100 % of canvas (origin top-left).",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
        rect: z.object({
          x: z.number().min(0).max(100),
          y: z.number().min(0).max(100),
          w: z.number().min(5).max(100),
          h: z.number().min(5).max(100),
        }),
      }),
      execute: async ({ id, kind, rect }) => {
        const px = pctRectToPx(rect, ctx.snapshot.viewport);
        const events: AgentEvent[] = [
          { type: "ui.resize", room: kind as RoomKind | undefined, rect: px },
        ];
        return applyAndEmit(
          ctx,
          "set_window_rect",
          { id, kind, rect_pct: rect },
          events,
        );
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
        "Tile every open window using a named preset. The geometry — outer margin, inter-window gutter, subject-slot sizing — is pre-determined; you only pick a name. Subject (slot 0) is the focused window. Choose by intent (see system prompt for the picker table).",
      inputSchema: z.object({ layout: LAYOUT_PRESET }),
      execute: async ({ layout }) => {
        // Bypass the standard applyAndEmit flow: arrange_windows
        // emits one ui.resize per window using the rects the simulator
        // computed, instead of a single ui.arrange that would force
        // the client to know preset geometry too.
        ctx.emit({
          type: "agent.tool.start",
          name: "arrange_windows",
          args: { layout },
        });
        const result = applyToolToSnapshot(ctx.snapshot, "arrange_windows", {
          layout,
        });
        ctx.snapshot = result.snapshot;
        for (const w of ctx.snapshot.windows) {
          ctx.emit({
            type: "ui.resize",
            room: w.kind,
            rect: pctRectToPx(w.rect, ctx.snapshot.viewport),
          });
        }
        ctx.emit({
          type: "agent.tool.done",
          name: "arrange_windows",
          ok: (result.ok ?? true),
        });
        return result.message;
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

    integration_connect: tool({
      description:
        "Kick off the OAuth flow for an integration. Opens the integration window for the slug if it isn't already open, then fires the Composio connect popup. Only valid in windowed mode AND when user_id is set in settings.",
      inputSchema: z.object({ slug: TOOLKIT_SLUG }),
      execute: async ({ slug }) => {
        // Defense-in-depth: surface a clear failure if user_id is missing
        // so the orchestrator's reply can guide the user to settings.
        if (!ctx.snapshot.user.userId) {
          return "user_id is not set — open settings and enter one first";
        }
        const events: AgentEvent[] = [
          // Make sure the integration window is on canvas so the user
          // sees the connect spinner/state.
          { type: "ui.room", room: "integration", payload: { slug } },
          // The IntegrationRoom registers a `connect` room-tool that
          // performs the actual popup + poll cycle.
          {
            type: "ui.tool",
            room: "integration",
            tool: "connect",
            args: { slug },
          },
        ];
        return applyAndEmit(ctx, "integration_connect", { slug }, events);
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
    graph_highlight: tool({
      description:
        "Highlight a node and its direct neighbors (no zoom change). Pass empty string to clear.",
      inputSchema: z.object({ node_id: z.string() }),
      execute: async ({ node_id }) => dispatch("highlight", { node_id }),
    }),
    graph_zoom_to: tool({
      description:
        "Set the graph zoom level. Range 0.2 (far / overview) to 4 (close / detail).",
      inputSchema: z.object({ scale: z.number().min(0.2).max(4) }),
      execute: async ({ scale }) => dispatch("zoom_to", { scale }),
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
 *  `updateWindowRect` understands. The client uses pixel rects, so we
 *  translate at the server boundary using the snapshot's actual
 *  viewport (sent by the browser on every request). This way the
 *  layout looks correct on any screen — no hardcoded 1440×900. */
function mountToClientRect(
  mount: MountPoint,
  viewport: { w: number; h: number },
): { x?: number; y?: number; w?: number; h?: number } {
  return pctRectToPx(mountRectPctLocal(mount), viewport);
}

function pctRectToPx(
  rect: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  // Subtract a small dock buffer so windows don't slide under the
  // floating dock at the bottom of the canvas. ~80px is the dock + gap.
  const usableH = Math.max(200, viewport.h - 80);
  return {
    x: Math.round((rect.x / 100) * viewport.w),
    y: Math.round((rect.y / 100) * usableH),
    w: Math.round((rect.w / 100) * viewport.w),
    h: Math.round((rect.h / 100) * usableH),
  };
}

/** Named-mount geometry — every mount honours OUTER margin from the
 *  canvas edges and GUTTER between adjacent mounts. Same constants as
 *  `lib/agent/server-snapshot.ts` so `arrange_windows` and `move_window`
 *  produce visually consistent layouts. */
const OUTER = 2.5;
const GUTTER = 2.5;

function mountRectPctLocal(mount: MountPoint) {
  const O = OUTER;
  const G = GUTTER;
  const FULL = 100 - 2 * O;
  const HALF = (FULL - G) / 2;
  const THIRD = (FULL - 2 * G) / 3;
  const Q = (FULL - G) / 2; // quadrant side, same as HALF

  switch (mount) {
    case "full":         return { x: O,             y: O,             w: FULL,  h: FULL };
    case "left-half":    return { x: O,             y: O,             w: HALF,  h: FULL };
    case "right-half":   return { x: O + HALF + G,  y: O,             w: HALF,  h: FULL };
    case "top-half":     return { x: O,             y: O,             w: FULL,  h: HALF };
    case "bottom-half":  return { x: O,             y: O + HALF + G,  w: FULL,  h: HALF };
    case "left-third":   return { x: O,             y: O,             w: THIRD, h: FULL };
    case "center-third": return { x: O + THIRD + G, y: O,             w: THIRD, h: FULL };
    case "right-third":  return { x: O + 2*(THIRD+G), y: O,           w: THIRD, h: FULL };
    case "tl":           return { x: O,             y: O,             w: Q,     h: Q };
    case "tr":           return { x: O + Q + G,     y: O,             w: Q,     h: Q };
    case "bl":           return { x: O,             y: O + Q + G,     w: Q,     h: Q };
    case "br":           return { x: O + Q + G,     y: O + Q + G,     w: Q,     h: Q };
    case "pip-br":       return { x: 100 - O - 25,  y: 100 - O - 22,  w: 25,    h: 22 };
    case "pip-tr":       return { x: 100 - O - 25,  y: O,             w: 25,    h: 22 };
    case "freeform":     return { x: 25,            y: 15,            w: 50,    h: 70 };
  }
}

export type LayoutToolBag = ReturnType<typeof layoutTools>;
export type ContentToolBag = ReturnType<typeof contentTools>;
export type GraphToolBag = ReturnType<typeof graphTools>;
