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

export const WINDOW_KIND = z.enum([
  "run_code",
  "save_workflow",
  "view_workflow",
  "run_workflow",
  "list_workflows",
  "find_examples",
  "search_memory",
  "ask_user",
  "graph",
  "settings",
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
        "Open a window of a given kind. If already open, brings it forward. Primarily for graph and settings; V1 work tools (run_code, etc.) open their own windows automatically.",
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
 *  V1 Work tools — the 8 harness tools
 *
 *  Each tool opens/updates its corresponding window via `ui.tool.open`
 *  events. Mock-first: tools return deterministic results. Swap
 *  TOOL_BASE_URL to live MCP harness when ready.
 * ------------------------------------------------------------------ */

export function v1WorkTools(ctx: AgentToolCtx) {
  /** Emit ui.tool.open, record in snapshot, return result message. */
  function emitToolWindow(
    toolName: string,
    args: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): string {
    const events: AgentEvent[] = [
      {
        type: "ui.tool.open",
        kind: toolName as WindowKind,
        payload: { ...payload, status: "done" },
      },
    ];
    return applyAndEmit(ctx, toolName, args, events);
  }

  return {
    run_code: tool({
      description:
        "Execute code. Opens the run_code window showing code + stdout/stderr/result.",
      inputSchema: z.object({
        code: z.string().min(1),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async ({ code, args: codeArgs }) => {
        const payload = {
          code,
          args: codeArgs ?? {},
          result: null,
          stdout: "# mock output\nhello world",
          stderr: "",
          error: null,
        };
        return emitToolWindow("run_code", { code, args: codeArgs }, payload);
      },
    }),

    save_workflow: tool({
      description:
        "Save code as a named workflow. Confirm-gated — stages a confirm before executing. Opens save_workflow window.",
      inputSchema: z.object({
        name: z.string().min(1),
        code: z.string().min(1),
        overwrite: z.boolean().optional(),
      }),
      execute: async ({ name, code, overwrite }) => {
        ctx.emit({
          type: "ui.confirm",
          intent: {
            id: `confirm-${Date.now()}`,
            toolName: "save_workflow",
            description: `Save workflow "${name}" (${code.length} bytes)?`,
            stagedAt: Date.now(),
            args: { name, code, overwrite },
          },
        });
        const payload = {
          name,
          code,
          overwrite: overwrite ?? false,
          url: `https://microbots.dev/wf/${name}`,
          saved_to: name,
          bytes: code.length,
          status: "confirm_pending",
        };
        return emitToolWindow("save_workflow", { name, code, overwrite }, payload);
      },
    }),

    view_workflow: tool({
      description:
        "View a saved workflow's source code. Opens view_workflow window.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
      execute: async ({ name }) => {
        const payload = {
          name,
          slug: name,
          code: `# workflow: ${name}\nprint("hello from ${name}")`,
          bytes: 42,
          modified_at: new Date().toISOString(),
        };
        return emitToolWindow("view_workflow", { name }, payload);
      },
    }),

    run_workflow: tool({
      description:
        "Run a saved workflow by name. Confirm-gated. Opens run_workflow window.",
      inputSchema: z.object({
        name: z.string().min(1),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async ({ name, args: runArgs }) => {
        ctx.emit({
          type: "ui.confirm",
          intent: {
            id: `confirm-${Date.now()}`,
            toolName: "run_workflow",
            description: `Run workflow "${name}"?`,
            stagedAt: Date.now(),
            args: { name, args: runArgs },
          },
        });
        const payload = {
          name,
          args: runArgs ?? {},
          result: { ok: true },
          stdout: `Running ${name}...\nDone.`,
          stderr: "",
          error: null,
          status: "confirm_pending",
        };
        return emitToolWindow("run_workflow", { name, args: runArgs }, payload);
      },
    }),

    list_workflows: tool({
      description:
        "List all saved workflows. Opens list_workflows window.",
      inputSchema: z.object({}),
      execute: async () => {
        const payload = {
          count: 3,
          workflows: [
            { slug: "bug-triage", summary: "Triage incoming bugs", bytes: 256, modified_at: new Date().toISOString() },
            { slug: "daily-standup", summary: "Generate standup from Slack", bytes: 512, modified_at: new Date().toISOString() },
            { slug: "pr-review", summary: "Auto-review pull requests", bytes: 384, modified_at: new Date().toISOString() },
          ],
        };
        return emitToolWindow("list_workflows", {}, payload);
      },
    }),

    find_examples: tool({
      description:
        "Search example workflows by query. Opens find_examples window.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => {
        const payload = {
          query,
          count: 2,
          matches: [
            { id: "ex-slack-summary", title: "Slack Channel Summary", description: "Summarize a Slack channel daily", tags: ["slack", "summary"], code: "# example" },
            { id: "ex-github-pr", title: "GitHub PR Review", description: "Auto-review GitHub PRs", tags: ["github", "review"], code: "# example" },
          ],
        };
        return emitToolWindow("find_examples", { query }, payload);
      },
    }),

    search_memory: tool({
      description:
        "Search the knowledge graph and recent chats. Opens search_memory window.",
      inputSchema: z.object({
        query: z.string().min(1),
        scope: z.enum(["kg", "recent_chats", "all"]).optional().default("all"),
      }),
      execute: async ({ query, scope }) => {
        const payload = {
          query,
          scope,
          count: 2,
          results: [
            { source: "kg-entity-1", scope: "kg", snippet: `Found reference to "${query}" in knowledge graph`, score: 0.92 },
            { source: "chat-recent", scope: "recent_chats", snippet: `Discussed "${query}" in recent conversation`, score: 0.78 },
          ],
        };
        return emitToolWindow("search_memory", { query, scope }, payload);
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
