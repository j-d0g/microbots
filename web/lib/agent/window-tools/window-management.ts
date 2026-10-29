/**
 * Comprehensive window management tool registry.
 *
 * Handles window positioning, pinning, and arrangement operations.
 * These tools provide fine-grained control over the window layout system,
 * allowing the UI agent to manipulate window positions, z-index, pin states,
 * and apply various layout presets.
 *
 * Tool categories:
 *   - POSITION & ARRANGEMENT: move, arrange
 *   - PINNING: pin/unpin/toggle, list pinned
 *   - FOCUS & Z-INDEX: bring to front, get focused
 *   - SIZE & RESIZE: resize, maximize, minimize
 *   - MULTI-WINDOW OPS: close all except, cascade, tile
 *   - STATE: read layout state, read window list
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { CanvasSnapshot, MountPoint } from "../types";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";
import { LAYOUT_PRESET, type AgentToolCtx } from "../tools";

/* ------------------------------------------------------------------ *
 *  Zod Schemas for Input Validation
 * ------------------------------------------------------------------ */

/** Available mount points for window positioning */
const MOUNT_POINT = z.enum([
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

/** Window kind schema */
const WINDOW_KIND = z.enum([
  "graph",
  "chat",
  "ask_user",
  "settings",
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
  "composio_connect",
]);

/** Rectangle schema for position/size operations */
const RECT_SCHEMA = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(1).max(100),
  h: z.number().min(1).max(100),
});

/* ------------------------------------------------------------------ *
 *  Helper Functions
 * ------------------------------------------------------------------ */

/** Emit tool lifecycle events and apply changes to snapshot */
function applyAndEmit(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
  uiEvents: AgentEvent[],
  options?: { ok?: boolean; message?: string },
): string {
  ctx.emit({ type: "agent.tool.start", name: toolName, args });
  for (const e of uiEvents) ctx.emit(e);
  const result = applyToolToSnapshot(ctx.snapshot, toolName, args, options?.ok);
  ctx.snapshot = result.snapshot;
  ctx.emit({ type: "agent.tool.done", name: toolName, ok: (result.ok ?? true) });
  return options?.message ?? result.message;
}

/** Find a window by id or kind, preferring id if provided */
function findWindow(
  snapshot: CanvasSnapshot,
  id?: string,
  kind?: WindowKind,
): { id: string; kind: WindowKind } | null {
  if (id) {
    const w = snapshot.windows.find((w) => w.id === id && !w.minimized);
    if (w) return { id: w.id, kind: w.kind as WindowKind };
  }
  if (kind) {
    const matching = snapshot.windows.filter((w) => w.kind === kind && !w.minimized);
    if (matching.length > 0) {
      const top = matching.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
      return { id: top.id, kind: top.kind as WindowKind };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Window Management Tools
 * ------------------------------------------------------------------ */

export function windowManagementTools(ctx: AgentToolCtx) {
  return {
    /* ================================================================ *
     *  POSITION & ARRANGEMENT
     * ================================================================ */

    /**
     * Move window to specific mount point.
     * Mount points: full, left-half, right-half, right-wide, top-half,
     * bottom-half, left-third, center-third, right-third, tl, tr, bl,
     * br, pip-br, pip-tr
     */
    winman_move_to_position: tool({
      description:
        "Move a window to a specific mount point position. Use id to target specific window, or kind to target most recent of that type. Mount points: full, left-half, right-half, right-wide, top-half, bottom-half, left-third, center-third, right-third, tl, tr, bl, br, pip-br, pip-tr.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
        mount: MOUNT_POINT,
      }),
      execute: async ({ id, kind, mount }) => {
        const target = findWindow(ctx.snapshot, id, kind);
        if (!target) {
          return applyAndEmit(ctx, "winman_move_to_position", { id, kind, mount }, [], {
            ok: false,
            message: "No window matched the move request.",
          });
        }
        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "move", id: target.id, mount: mount as MountPoint },
        }];
        return applyAndEmit(ctx, "winman_move_to_position", { id: target.id, kind, mount }, events);
      },
    }),

    /**
     * Apply a layout preset to arrange all windows.
     * Presets: focus, split, grid, stack-right, spotlight, theater, reading, triptych
     */
    winman_arrange_preset: tool({
      description:
        "Apply a layout preset to arrange all open windows. Presets: focus (subject-centered), split (2-column), grid (even grid), stack-right (main+sidebar), spotlight (hero+thumbnails), theater (top strip+bottom), reading (main+side stack), triptych (3-column).",
      inputSchema: z.object({
        preset: LAYOUT_PRESET,
      }),
      execute: async ({ preset }) => {
        return applyAndEmit(ctx, "winman_arrange_preset", { preset }, [{
          type: "ui.canvas",
          action: { type: "arrange", layout: preset },
        }], {
          message: `Arranged ${ctx.snapshot.windows.length} windows using ${preset} preset.`,
        });
      },
    }),

    /* ================================================================ *
     *  PINNING
     * ================================================================ */

    /**
     * Pin a window to the left sideline.
     */
    winman_pin_window: tool({
      description:
        "Pin a window to the left sideline. Pinned windows stay in place and are protected from auto-eviction. Maximum 2 pinned windows allowed.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ id, kind }) => {
        const target = findWindow(ctx.snapshot, id, kind);
        if (!target) {
          return applyAndEmit(ctx, "winman_pin_window", { id, kind }, [], {
            ok: false,
            message: "No window matched the pin request.",
          });
        }

        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "pin", id: target.id, pinned: true },
        }];

        return applyAndEmit(ctx, "winman_pin_window", { id: target.id }, events);
      },
    }),

    /**
     * Unpin a window (move to right sideline).
     */
    winman_unpin_window: tool({
      description:
        "Unpin a window, moving it to the right sideline. Unpinned windows can be auto-evicted when the window cap is reached.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ id, kind }) => {
        const target = findWindow(ctx.snapshot, id, kind);
        if (!target) {
          return applyAndEmit(ctx, "winman_unpin_window", { id, kind }, [], {
            ok: false,
            message: "No window matched the unpin request.",
          });
        }

        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "pin", id: target.id, pinned: false },
        }];

        return applyAndEmit(ctx, "winman_unpin_window", { id: target.id }, events);
      },
    }),

    /**
     * Toggle pin state of current or specified window.
     */
    winman_toggle_pin: tool({
      description:
        "Toggle the pin state of a window. If pinned, unpins it; if unpinned, pins it. Defaults to currently focused window if no id/kind specified.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ id, kind }) => {
        const target = id || kind
          ? findWindow(ctx.snapshot, id, kind)
          : ctx.snapshot.focusedId
            ? findWindow(ctx.snapshot, ctx.snapshot.focusedId)
            : null;

        if (!target) {
          return applyAndEmit(ctx, "winman_toggle_pin", { id, kind }, [], {
            ok: false,
            message: "No window matched the pin toggle request.",
          });
        }

        const existing = ctx.snapshot.windows.find((window) => window.id === target.id);
        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "pin", id: target.id, pinned: !existing?.pinned },
        }];

        return applyAndEmit(ctx, "winman_toggle_pin", { id: target.id }, events);
      },
    }),

    /**
     * List all pinned windows.
     */
    winman_read_pinned: tool({
      description:
        "Read the list of all currently pinned windows. Returns their ids, kinds, and positions. Does not modify state.",
      inputSchema: z.object({}),
      execute: async () => {
        // This is a read-only operation - no UI events needed
        const pinned = ctx.snapshot.windows.filter((w) => w.pinned);

        ctx.emit({ type: "agent.tool.start", name: "winman_read_pinned", args: {} });
        ctx.emit({ type: "agent.tool.done", name: "winman_read_pinned", ok: true });

        if (pinned.length === 0) {
          return "No pinned windows currently.";
        }

        const list = pinned.map((w) => `${w.kind} (${w.id})`).join(", ");
        return `Pinned windows: ${list}`;
      },
    }),

    /* ================================================================ *
     *  FOCUS & Z-INDEX
     * ================================================================ */

    /**
     * Bring window to highest z-index (front).
     */
    winman_bring_to_front: tool({
      description:
        "Bring a window to the front by setting it to the highest z-index. Use id or kind to identify the window.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ id, kind }) => {
        const target = findWindow(ctx.snapshot, id, kind);
        if (!target) {
          return applyAndEmit(ctx, "winman_bring_to_front", { id, kind }, [], {
            ok: false,
            message: "No window matched the focus request.",
          });
        }

        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "focus", id: target.id },
        }];

        return applyAndEmit(ctx, "winman_bring_to_front", { id: target.id }, events);
      },
    }),

    /**
     * Get currently focused window.
     */
    winman_read_focused: tool({
      description:
        "Read information about the currently focused window (highest z-index). Returns id, kind, mount, and rect. Does not modify state.",
      inputSchema: z.object({}),
      execute: async () => {
        ctx.emit({ type: "agent.tool.start", name: "winman_read_focused", args: {} });
        ctx.emit({ type: "agent.tool.done", name: "winman_read_focused", ok: true });

        const focused = ctx.snapshot.windows.find((w) => w.focused);
        if (!focused) {
          return "No window is currently focused.";
        }

        return `Focused window: ${focused.kind} (id=${focused.id}, mount=${focused.mount}, z=${focused.zIndex})`;
      },
    }),

    /* ================================================================ *
     *  SIZE & RESIZE
     * ================================================================ */

    /**
     * Resize window to specific dimensions (in percent).
     */
    winman_resize_window: tool({
      description:
        "Resize a window to specific dimensions. Position and size are in percent (0-100). Use id or kind to identify the window.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
        rect: RECT_SCHEMA,
      }),
      execute: async ({ id, kind, rect }) => {
        const target = findWindow(ctx.snapshot, id, kind);
        if (!target) {
          return applyAndEmit(ctx, "winman_resize_window", { id, kind, rect }, [], {
            ok: false,
            message: "No window matched the resize request.",
          });
        }

        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "set_rect", id: target.id, rect },
        }];

        return applyAndEmit(ctx, "winman_resize_window", { id: target.id, rect }, events);
      },
    }),

    /**
     * Maximize window to fill available space.
     */
    winman_maximize_window: tool({
      description:
        "Maximize a window to fill its available space (effectively 'full' mount point). Use id or kind to identify the window.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ id, kind }) => {
        const target = findWindow(ctx.snapshot, id, kind);
        if (!target) {
          return applyAndEmit(ctx, "winman_maximize_window", { id, kind }, [], {
            ok: false,
            message: "No window matched the maximize request.",
          });
        }

        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "move", id: target.id, mount: "full" },
        }];

        return applyAndEmit(ctx, "winman_maximize_window", { id: target.id }, events);
      },
    }),

    /**
     * Minimize window to small floating view.
     */
    winman_minimize_window: tool({
      description:
        "Minimize a window to a small floating view (picture-in-picture bottom-right). Use id or kind to identify the window.",
      inputSchema: z.object({
        id: z.string().optional(),
        kind: WINDOW_KIND.optional(),
      }),
      execute: async ({ id, kind }) => {
        const target = findWindow(ctx.snapshot, id, kind);
        if (!target) {
          return applyAndEmit(ctx, "winman_minimize_window", { id, kind }, [], {
            ok: false,
            message: "No window matched the minimize request.",
          });
        }

        const events: AgentEvent[] = [{
          type: "ui.canvas",
          action: { type: "minimize", id: target.id, minimized: true },
        }];

        return applyAndEmit(ctx, "winman_minimize_window", { id: target.id }, events);
      },
    }),

    /* ================================================================ *
     *  MULTI-WINDOW OPERATIONS
     * ================================================================ */

    /**
     * Close all windows except specified ones.
     */
    winman_close_all_except: tool({
      description:
        "Close all windows except the specified ones. Provide an array of window ids to keep open. If empty, closes all windows.",
      inputSchema: z.object({
        keep_ids: z.array(z.string()).optional().default([]),
      }),
      execute: async ({ keep_ids }) => {
        const windowsToClose = ctx.snapshot.windows.filter((w) => !keep_ids.includes(w.id));

        const events: AgentEvent[] = windowsToClose.map((w) => ({
          type: "ui.canvas" as const,
          action: { type: "close" as const, id: w.id },
        }));

        return applyAndEmit(ctx, "winman_close_all_except", { keep_ids }, events);
      },
    }),

    /**
     * Arrange windows in cascade formation.
     */
    winman_cascade_windows: tool({
      description:
        "Arrange all open windows in a cascade formation (stacked diagonally with offset). Each window is slightly offset from the previous.",
      inputSchema: z.object({
        offset: z.number().min(5).max(30).optional().default(10),
      }),
      execute: async ({ offset }) => {
        const events: AgentEvent[] = ctx.snapshot.windows.map((window, index) => ({
          type: "ui.canvas",
          action: {
            type: "set_rect",
            id: window.id,
            rect: {
              ...window.rect,
              x: Math.min(100 - window.rect.w, window.rect.x + index * offset),
              y: Math.min(100 - window.rect.h, window.rect.y + index * offset),
            },
          },
        }));

        return applyAndEmit(ctx, "winman_cascade_windows", { offset }, events);
      },
    }),

    /**
     * Tile windows evenly in a grid.
     */
    winman_tile_windows: tool({
      description:
        "Tile all open windows evenly in a grid layout. Automatically calculates rows/columns based on window count.",
      inputSchema: z.object({
        columns: z.number().min(1).max(6).optional(),
      }),
      execute: async ({ columns }) => {
        void columns;
        return applyAndEmit(ctx, "winman_tile_windows", { columns }, [{
          type: "ui.canvas",
          action: { type: "arrange", layout: "grid" },
        }], {
          message: `Tiled ${ctx.snapshot.windows.length} windows in grid layout.`,
        });
      },
    }),

    /* ================================================================ *
     *  STATE READERS
     * ================================================================ */

    /**
     * Read current layout state.
     */
    winman_read_layout_state: tool({
      description:
        "Read the current layout state including centre stage, sidelines, and backdrop status. Returns counts and arrangement info. Does not modify state.",
      inputSchema: z.object({}),
      execute: async () => {
        ctx.emit({ type: "agent.tool.start", name: "winman_read_layout_state", args: {} });
        ctx.emit({ type: "agent.tool.done", name: "winman_read_layout_state", ok: true });

        const { windows, viewport, focusedId } = ctx.snapshot;
        const count = windows.length;

        // Simple heuristic for layout state
        const hasBackdrop = windows.some((w) => w.kind === "graph" && w.zIndex < 10);
        const centreCount = windows.filter((w) => w.zIndex > 20 && w.zIndex < 100).length;
        const sidelineCount = windows.filter((w) => w.zIndex >= 10 && w.zIndex <= 20).length;

        return (
          `Layout state: ${count} windows total, ` +
          `centre: ${centreCount}, sidelines: ${sidelineCount}, ` +
          `backdrop: ${hasBackdrop ? "active" : "none"}, ` +
          `viewport: ${viewport.w}x${viewport.h}, ` +
          `focused: ${focusedId || "none"}`
        );
      },
    }),

    /**
     * List all open windows with positions.
     */
    winman_read_window_list: tool({
      description:
        "List all open windows with their positions, sizes, z-index, and mount points. Does not modify state.",
      inputSchema: z.object({}),
      execute: async () => {
        ctx.emit({ type: "agent.tool.start", name: "winman_read_window_list", args: {} });
        ctx.emit({ type: "agent.tool.done", name: "winman_read_window_list", ok: true });

        const { windows } = ctx.snapshot;

        if (windows.length === 0) {
          return "No windows currently open.";
        }

        const list = windows
          .map((w) => {
            const rect = `${w.rect.x.toFixed(0)},${w.rect.y.toFixed(0)} ${w.rect.w.toFixed(0)}×${w.rect.h.toFixed(0)}`;
            return `${w.kind} (id=${w.id.slice(-6)}, z=${w.zIndex}, ${w.mount}, ${rect})${w.focused ? " [FOCUSED]" : ""}`;
          })
          .join("\n");

        return `${windows.length} windows open:\n${list}`;
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Type Exports
 * ------------------------------------------------------------------ */

export type WindowManagementToolBag = ReturnType<typeof windowManagementTools>;
