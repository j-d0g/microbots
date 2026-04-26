/**
 * V1 tool surface for the orchestrator.
 *
 * Three buckets:
 *   - META TOOLS — window management (open/close/focus/arrange/clear).
 *   - V1 WORK TOOLS — the 8 harness tools. Each opens/updates its own
 *     window via `ui.tool.open` events. Mock-first; swap URL to live
 *     MCP harness when ready.
 *   - GRAPH TOOLS — per-window tools for the graph canvas.
 *
 * Each tool's `execute()` receives a shared `AgentToolCtx` that owns the
 * mutable server-side snapshot and an event sink the route reads to
 * forward SSE events to the browser.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "./server-snapshot";
import type { MountPoint } from "./types";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

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
  snapshot: import("./types").CanvasSnapshot;
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

/* Schema-driven window kinds (v2). Matches the `WindowKind` union in
 * `lib/store.ts`; every entry corresponds to either a UX primitive or
 * a `/api/kg/*` endpoint. */
export const WINDOW_KIND = z.enum([
  // cross-cutting
  "graph",
  "chat",
  "ask_user",
  "settings",
  // schema-backed
  "profile",
  "integrations",
  "integration_detail",
  "entities",
  "entity_detail",
  "memories",
  "skills",
  "workflows",
  "wiki",
  "chats_summary",
]);

export const MOUNT_POINT = z.enum([
  "full",
  "left-half",
  "right-half",
  "right-wide",
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

/* ------------------------------------------------------------------ *
 *  Meta tools (window management)
 * ------------------------------------------------------------------ */

export function metaTools(ctx: AgentToolCtx) {
  return {
    open_window: tool({
      description:
        "Open a window of a given kind. If already open, brings it forward. Each kind is backed by a real endpoint: profile (/user), integrations (/integrations), integration_detail (/integrations/{slug}), entities (/entity-types + /entities), entity_detail (/entities/{id}), memories (/memories), skills (/skills), workflows (/workflows), wiki (/wiki), chats_summary (/chats/summary). Plus the cross-cutting graph, chat, ask_user, settings.",
      inputSchema: z.object({
        kind: WINDOW_KIND,
        mount: MOUNT_POINT.optional().default("full"),
      }),
      execute: async ({ kind, mount }) => {
        const events: AgentEvent[] = [
          { type: "ui.room", room: kind as WindowKind },
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
          { type: "ui.close_window", room: kind as WindowKind | undefined },
        ];
        return applyAndEmit(ctx, "close_window", { id, kind }, events);
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
        const events: AgentEvent[] = kind
          ? [{ type: "ui.room", room: kind as WindowKind }]
          : [];
        return applyAndEmit(ctx, "focus_window", { id, kind }, events);
      },
    }),

    arrange_windows: tool({
      description:
        "Tile every open window using a named preset. Rare — stage-manager auto-positions. Presets: focus | split | grid | stack-right | spotlight | theater | reading | triptych.",
      inputSchema: z.object({ layout: LAYOUT_PRESET }),
      execute: async ({ layout }) => {
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
            room: w.kind as WindowKind,
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
        const events: AgentEvent[] = ctx.snapshot.windows.map((w) => ({
          type: "ui.close_window" as const,
          room: w.kind as WindowKind,
        }));
        return applyAndEmit(ctx, "clear_canvas", {}, events);
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  V1 Work tools — the schema-aligned tool surface
 *
 *  Each tool opens/updates its corresponding window via `ui.tool.open`
 *  events. Tools are KG-write focused (memory / entity / skill /
 *  workflow / chat upserts) plus the modal `ask_user` primitive. Read
 *  surfaces are handled by `open_window` — each window fetches its
 *  own data via `kg-client.ts`.
 *
 *  Tools that mutate the KG (add_memory etc.) currently emit
 *  optimistic UI events; once the FastAPI app is reachable we'll
 *  swap the `execute` body for a real `kg-client.ts` call.
 * ------------------------------------------------------------------ */

export function v1WorkTools(ctx: AgentToolCtx) {
  /** Emit ui.tool.open with the corresponding schema-backed window kind. */
  function emitToolWindow(
    toolName: string,
    args: Record<string, unknown>,
    kind: WindowKind,
    payload: Record<string, unknown>,
  ): string {
    const events: AgentEvent[] = [
      {
        type: "ui.tool.open",
        kind,
        payload: { ...payload, status: "done" },
      },
    ];
    return applyAndEmit(ctx, toolName, args, events);
  }

  return {
    add_memory: tool({
      description:
        "Record a new memory in the KG. Opens the memories window. Idempotent on content hash. Optionally bind to an entity, integration, or chat.",
      inputSchema: z.object({
        content: z.string().min(1),
        memory_type: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        source: z.string().optional(),
        tags: z.array(z.string()).optional(),
        about_entity_id: z.string().optional(),
        about_integration_slug: z.string().optional(),
      }),
      execute: async (input) => {
        return emitToolWindow(
          "add_memory",
          input as Record<string, unknown>,
          "memories",
          { by: "recency" },
        );
      },
    }),

    upsert_entity: tool({
      description:
        "Create or merge an entity (person/team/project/doc/...) in the KG. Idempotent on `${entity_type}_${slug(name)}`. Opens the entity_detail window.",
      inputSchema: z.object({
        name: z.string().min(1),
        entity_type: z.string().min(1),
        description: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        appears_in_integration: z.string().optional(),
        appears_in_handle: z.string().optional(),
        appears_in_role: z.string().optional(),
      }),
      execute: async (input) => {
        return emitToolWindow(
          "upsert_entity",
          input as Record<string, unknown>,
          "entity_detail",
          { name: input.name, entity_type: input.entity_type },
        );
      },
    }),

    upsert_skill: tool({
      description:
        "Create or strengthen a skill (reusable capability). `strength_increment` is added to the existing strength on each call. Opens the skills window.",
      inputSchema: z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        steps: z.array(z.string()).optional(),
        frequency: z.string().optional(),
        strength_increment: z.number().min(1).max(10).optional(),
        tags: z.array(z.string()).optional(),
        uses_integrations: z.array(z.string()).optional(),
      }),
      execute: async (input) => {
        return emitToolWindow(
          "upsert_skill",
          input as Record<string, unknown>,
          "skills",
          {},
        );
      },
    }),

    upsert_workflow: tool({
      description:
        "Save a named workflow. Provided `skill_chain` REPLACES the existing chain. Opens the workflows window with the saved entry focused.",
      inputSchema: z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        trigger: z.string().optional(),
        outcome: z.string().optional(),
        frequency: z.string().optional(),
        tags: z.array(z.string()).optional(),
        skill_chain: z
          .array(z.object({ slug: z.string(), step_order: z.number() }))
          .optional(),
      }),
      execute: async (input) => {
        return emitToolWindow(
          "upsert_workflow",
          input as Record<string, unknown>,
          "workflows",
          { slug: input.slug, name: input.name },
        );
      },
    }),

    add_chat: tool({
      description:
        "Persist a chat turn. Source-keyed dedup via `source_id`. Optional integration origin and entity mentions.",
      inputSchema: z.object({
        content: z.string().min(1),
        source_type: z.string().min(1),
        source_id: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        signal_level: z.enum(["low", "mid", "high"]).optional(),
        from_integration: z.string().optional(),
        mentions: z
          .array(
            z.object({
              id: z.string(),
              mention_type: z.string().optional(),
            }),
          )
          .optional(),
      }),
      execute: async (input) => {
        return emitToolWindow(
          "add_chat",
          input as Record<string, unknown>,
          "chats_summary",
          {},
        );
      },
    }),

    write_wiki_page: tool({
      description:
        "Author or update a wiki page at the given path. No-op when content unchanged; otherwise increments revision.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        rationale: z.string().optional(),
      }),
      execute: async ({ path, content, rationale }) => {
        return emitToolWindow(
          "write_wiki_page",
          { path, content, rationale },
          "wiki",
          { path },
        );
      },
    }),

    update_user: tool({
      description:
        "Update the singleton user profile (name, role, goals, preferences, context_window).",
      inputSchema: z.object({
        name: z.string().optional(),
        role: z.string().optional(),
        goals: z.array(z.string()).optional(),
        preferences: z.record(z.string(), z.unknown()).optional(),
        context_window: z.number().min(512).max(200000).optional(),
      }),
      execute: async (input) => {
        return emitToolWindow(
          "update_user",
          input as Record<string, unknown>,
          "profile",
          {},
        );
      },
    }),

    ask_user: tool({
      description:
        "Ask the user a question with optional multiple-choice options. Opens a modal focus card. Use when you need clarification or a decision.",
      inputSchema: z.object({
        question: z.string().min(1),
        options: z.array(z.string()).max(4).optional(),
      }),
      execute: async ({ question, options }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.ask",
            question,
            options: options ?? [],
          },
        ];
        return applyAndEmit(ctx, "ask_user", { question, options }, events);
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Graph tools — per-window tools for the graph canvas.
 * ------------------------------------------------------------------ */

export function graphTools(ctx: AgentToolCtx) {
  const ensureGraph = (): AgentEvent[] =>
    ctx.snapshot.windows.some((w) => w.kind === "graph")
      ? []
      : [{ type: "ui.room", room: "graph" as WindowKind }];

  const dispatch = (toolName: string, args: Record<string, unknown>): string => {
    const events: AgentEvent[] = [
      ...ensureGraph(),
      { type: "ui.tool", room: "graph" as WindowKind, tool: toolName, args },
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

function pctRectToPx(
  rect: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const usableH = Math.max(200, viewport.h - 80);
  return {
    x: Math.round((rect.x / 100) * viewport.w),
    y: Math.round((rect.y / 100) * usableH),
    w: Math.round((rect.w / 100) * viewport.w),
    h: Math.round((rect.h / 100) * usableH),
  };
}

export type MetaToolBag = ReturnType<typeof metaTools>;
export type V1WorkToolBag = ReturnType<typeof v1WorkTools>;
export type GraphToolBag = ReturnType<typeof graphTools>;

/** @deprecated Use metaTools instead. Alias for backward compat. */
export const layoutTools = metaTools;
export type LayoutToolBag = MetaToolBag;
