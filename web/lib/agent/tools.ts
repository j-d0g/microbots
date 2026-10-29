/**
 * V1 tool surface for the orchestrator.
 *
 * Three buckets:
 *   - META TOOLS — window management (open/close/focus/arrange/clear).
 *   - V1 WORK TOOLS — lightweight workflow actions that open their own
 *     windows via `ui.tool.open` events.
 *   - GRAPH TOOLS — per-window tools for the graph canvas.
 *
 * Each tool's `execute()` receives a shared `AgentToolCtx` that owns the
 * mutable server-side snapshot and an event sink the route reads to
 * forward SSE events to the browser.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyCanvasToSnapshot } from "./server-snapshot";
import { canvasActionForEvent } from "./canvas-reducer";
import { getKgWorkflows, getKgMemories } from "@/lib/api/backend";
import type { CanvasSnapshot } from "./types";
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
  snapshot: CanvasSnapshot;
  emit: (event: AgentEvent) => void;
}

export function createToolCtx(
  snapshot: CanvasSnapshot,
  send: (event: AgentEvent) => void,
): AgentToolCtx {
  const ctx: AgentToolCtx = {
    snapshot,
    emit: (event) => {
      const action = canvasActionForEvent(event);
      if (action) ctx.snapshot = applyCanvasToSnapshot(ctx.snapshot, action);
      send(event);
    },
  };
  return ctx;
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
  resultOptions?: { ok?: boolean; message?: string },
): string {
  ctx.emit({ type: "agent.tool.start", name: toolName, args });
  for (const e of uiEvents) ctx.emit(e);
  const ok = resultOptions?.ok ?? true;
  ctx.emit({ type: "agent.tool.done", name: toolName, ok });
  return resultOptions?.message ?? `${toolName} ${ok ? "completed." : "failed."}`;
}

/* ------------------------------------------------------------------ *
 *  Enums (Zod) mirroring the TS unions
 * ------------------------------------------------------------------ */

export const WINDOW_KIND = z.enum([
  "integrations",
  "integration_detail",
  "entities",
  "entity_detail",
  "memories",
  "skills",
  "workflows",
  "graph",
  "ask_user",
  "composio_connect",
]);

/* ------------------------------------------------------------------ *
 *  Meta tools (chat canvas)
 * ------------------------------------------------------------------ */

export function metaTools(ctx: AgentToolCtx) {
  return {
    open_window: tool({
      description:
        "Open a card of a given kind. If already open, brings it forward. Optional focus centres a node, entity, or workflow.",
      inputSchema: z.object({
        kind: WINDOW_KIND,
        focus: z.string().optional().describe("node, entity or workflow to centre on"),
      }),
      execute: async ({ kind, focus }) => {
        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: {
            type: "open",
            kind: kind as WindowKind,
            ...(focus ? { payload: { focus } } : {}),
            openedBy: "agent",
          },
        }];
        return applyAndEmit(
          ctx,
          "open_window",
          { kind, ...(focus ? { focus } : {}) },
          events,
          { message: `Opened ${kind}.` },
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
        const matches = ctx.snapshot.windows.some((window) =>
          id ? window.id === id : kind ? window.kind === kind : window.id === ctx.snapshot.focusedId,
        );
        const events: AgentEvent[] = matches
          ? [{ type: "ui.canvas", action: { type: "close", id, kind } }]
          : [];
        return applyAndEmit(
          ctx,
          "close_window",
          { id, kind },
          events,
          matches ? undefined : { ok: false, message: "No window matched the close request." },
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
        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "focus", id, kind: kind as WindowKind | undefined },
        }];
        return applyAndEmit(ctx, "focus_window", { id, kind }, events, {
          message: `Focused ${kind ?? id ?? "window"}.`,
        });
      },
    }),

    clear_canvas: tool({
      description:
        "Close every open window. Use sparingly — only when the user explicitly asks for a clean slate.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [{ type: "ui.canvas", action: { type: "clear" } }];
        return applyAndEmit(ctx, "clear_canvas", {}, events, {
          message: "Cleared the canvas.",
        });
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  V1 Work tools
 *
 *  Each tool opens/updates its corresponding window via `ui.tool.open`
 *  events.
 * ------------------------------------------------------------------ */

export function v1WorkTools(ctx: AgentToolCtx) {
  /** Emit ui.tool.open, record in snapshot, return result message. */
  function emitToolWindow(
    toolName: string,
    args: Record<string, unknown>,
    payload: Record<string, unknown>,
    kind: WindowKind = "workflows",
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
    save_workflow: tool({
      description:
        "Save code as a named workflow in the knowledge graph. Opens the workflows card.",
      inputSchema: z.object({
        name: z.string().min(1),
        code: z.string().min(1),
        overwrite: z.boolean().optional(),
      }),
      execute: async ({ name, code, overwrite }) => {
        const payload = {
          name,
          code,
          overwrite: overwrite ?? false,
          saved_to: name,
          bytes: code.length,
          status: "done",
        };
        return emitToolWindow("save_workflow", { name, code, overwrite }, payload, "workflows");
      },
    }),

    view_workflow: tool({
      description:
        "View a saved workflow and its steps in the workflows card.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
      execute: async ({ name }) => {
        let payload: Record<string, unknown>;
        try {
          const kgWorkflows = await getKgWorkflows();
          const wf = kgWorkflows.find(
            (w) => w.slug === name || w.name === name,
          );
          if (!wf) {
            ctx.emit({ type: "agent.tool.start", name: "view_workflow", args: { name } });
            ctx.emit({ type: "agent.tool.done", name: "view_workflow", ok: false });
            return `Workflow "${name}" not found.`;
          }
          payload = {
            name: wf.name,
            slug: wf.slug,
            description: wf.description,
            trigger: wf.trigger ?? null,
            outcome: wf.outcome ?? null,
            skill_chain: wf.skill_chain ?? [],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "view_workflow", args: { name } });
          ctx.emit({ type: "agent.tool.done", name: "view_workflow", ok: false });
          return `Failed to view workflow: ${msg}`;
        }
        return emitToolWindow("view_workflow", { name }, payload);
      },
    }),

    list_workflows: tool({
      description:
        "List all saved workflows in the workflows card.",
      inputSchema: z.object({}),
      execute: async () => {
        let workflows: { slug: string; name: string; description: string }[] = [];
        try {
          const kgWorkflows = await getKgWorkflows();
          workflows = kgWorkflows.map((w) => ({
            slug: w.slug,
            name: w.name,
            description: w.description,
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "list_workflows", args: {} });
          ctx.emit({ type: "agent.tool.done", name: "list_workflows", ok: false });
          return `Failed to list workflows: ${msg}`;
        }
        const payload = {
          count: workflows.length,
          workflows,
        };
        return emitToolWindow("list_workflows", {}, payload);
      },
    }),

    search_memory: tool({
      description:
        "Search the knowledge graph and recent chats. Opens the memories window.",
      inputSchema: z.object({
        query: z.string().min(1),
        scope: z.enum(["kg", "recent_chats", "all"]).optional().default("all"),
      }),
      execute: async ({ query, scope }) => {
        let results: { source: string; scope: string; snippet: string; score: number }[] = [];
        try {
          const memories = await getKgMemories({ limit: 50 });
          const lowerQ = query.toLowerCase();
          results = memories
            .filter((m) => m.content.toLowerCase().includes(lowerQ))
            .map((m) => ({
              source: m.id,
              scope: "kg" as const,
              snippet: m.content,
              score: m.confidence,
            }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "search_memory", args: { query, scope } });
          ctx.emit({ type: "agent.tool.done", name: "search_memory", ok: false });
          return `Failed to search memory: ${msg}`;
        }
        const payload = {
          query,
          scope,
          count: results.length,
          results,
        };
        return emitToolWindow("search_memory", { query, scope }, payload, "memories");
      },
    }),

    ask_user: tool({
      description:
        "Ask the user a question with optional multiple-choice options. Use when you need clarification or a decision.",
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
        "Center the memory graph on a node and zoom in. Pass a node id ('int-linear', 'skill:triage_incoming_bug', 'workflow:bug_triage', 'entity:alice') or a label like 'Linear'.",
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
        "Open the node inspector for a node id ('int-linear', 'skill:triage_incoming_bug', 'workflow:bug_triage', 'entity:alice') or label like 'Linear'. Pass an empty string to clear focus.",
      inputSchema: z.object({ node_id: z.string() }),
      execute: async ({ node_id }) => dispatch("select", { node_id }),
    }),
    graph_neighbors: tool({
      description:
        "Highlight a node id ('int-linear', 'skill:triage_incoming_bug', 'workflow:bug_triage', 'entity:alice') or exact case-insensitive label and its 1-hop neighbors without changing zoom.",
      inputSchema: z.object({ node_id: z.string() }),
      execute: async ({ node_id }) => dispatch("neighbors", { node_id }),
    }),
    graph_highlight: tool({
      description:
        "Highlight a node id ('int-linear', 'skill:triage_incoming_bug', 'workflow:bug_triage', 'entity:alice') or label like 'Linear' and its direct neighbors without changing zoom. Pass empty string to clear.",
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
      description:
        "Highlight the shortest path between two node ids or exact case-insensitive labels.",
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

export type MetaToolBag = ReturnType<typeof metaTools>;
export type V1WorkToolBag = ReturnType<typeof v1WorkTools>;
export type GraphToolBag = ReturnType<typeof graphTools>;

/** @deprecated Use metaTools instead. Alias for backward compat. */
export const layoutTools = metaTools;
export type LayoutToolBag = MetaToolBag;
