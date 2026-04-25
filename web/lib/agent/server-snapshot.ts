/**
 * Server-side snapshot simulator.
 *
 * The canonical canvas state lives in the browser's Zustand store. The
 * server doesn't have direct access to it, but every agent turn needs
 * to reason against fresh state after each tool call. So we mirror the
 * client's reducers locally for the duration of a single request:
 *
 *   1. Client posts `{ query, snapshot }` once.
 *   2. Server keeps `snapshot` in a closure for the whole agent loop.
 *   3. Each tool's `execute()` calls `applyToolToSnapshot()` to evolve
 *      the local mirror AND emits the matching `AgentEvent`(s) for the
 *      browser to apply when the SSE stream reaches it.
 *
 * Pure JSON-in / JSON-out — no React, no Zustand, no fetch. Easy to
 * unit-test.
 */

import type {
  CanvasSnapshot,
  MountPoint,
  RectPct,
  ToolCallRecord,
  WindowSnapshot,
} from "./types";
import type { RoomKind } from "@/lib/store";

const RING_CAP = 6;

/** A canonical layout-preset → array-of-mount-assignment mapping. The
 *  client's `arrangeWindows` does pixel math; we do mount-name math
 *  here so the agent reasons in named anchors. */
const PRESET_TO_MOUNTS: Record<
  "focus" | "split" | "grid" | "stack-right",
  (n: number) => MountPoint[]
> = {
  focus: (n) => Array.from({ length: n }, (_, i) => (i === 0 ? "full" : "freeform")),
  split: (n) =>
    Array.from({ length: n }, (_, i) =>
      i === 0 ? "left-half" : i === 1 ? "right-half" : "freeform",
    ),
  grid: (n) => {
    if (n <= 1) return ["full"];
    if (n === 2) return ["left-half", "right-half"];
    if (n === 3) return ["left-third", "center-third", "right-third"];
    return ["tl", "tr", "bl", "br", ...Array(Math.max(0, n - 4)).fill("freeform" as MountPoint)];
  },
  "stack-right": (n) => {
    if (n <= 1) return ["full"];
    return [
      "left-half",
      ...Array.from({ length: n - 1 }, () => "right-half" as MountPoint),
    ];
  },
};

/** Resolve a mount name to a % rect. Same math as the client; we keep
 *  a copy here to avoid pulling browser-only modules into the server
 *  (the client `mount-points.ts` is tree-shake-friendly but importing
 *  it from a route is fine — we re-implement to keep the server module
 *  self-contained and faster to test). */
function rectForMount(mount: MountPoint): RectPct {
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

let _serverIdSeq = 0;
function nextServerId(): string {
  _serverIdSeq += 1;
  return `srv-${Date.now().toString(36)}-${_serverIdSeq}`;
}

function recordIntoRing(
  prev: ToolCallRecord[],
  rec: ToolCallRecord,
): ToolCallRecord[] {
  const next = [...prev, rec];
  return next.length > RING_CAP ? next.slice(next.length - RING_CAP) : next;
}

function nextZ(snap: CanvasSnapshot): number {
  return snap.windows.reduce((m, w) => (w.zIndex > m ? w.zIndex : m), 0) + 1;
}

function withFocus(snap: CanvasSnapshot): CanvasSnapshot {
  const topZ = snap.windows.reduce(
    (m, w) => (w.zIndex > m ? w.zIndex : m),
    0,
  );
  return {
    ...snap,
    focusedId:
      snap.windows.find((w) => w.zIndex === topZ)?.id ?? snap.focusedId,
    windows: snap.windows.map((w) => ({ ...w, focused: w.zIndex === topZ })),
  };
}

/** Pluck a window by `id` first, falling back to most-recent open of
 *  matching `kind`. Returns null if neither matches. */
function findWindow(
  snap: CanvasSnapshot,
  selector: { id?: string; kind?: RoomKind },
): WindowSnapshot | null {
  if (selector.id) {
    return snap.windows.find((w) => w.id === selector.id) ?? null;
  }
  if (selector.kind) {
    const matching = snap.windows.filter((w) => w.kind === selector.kind);
    if (matching.length === 0) return null;
    return matching.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
  }
  return null;
}

export interface ToolApplyResult {
  snapshot: CanvasSnapshot;
  /** Brief, human-readable for the agent's tool-result message. */
  message: string;
}

/** Top-level dispatcher. Each branch returns a fresh snapshot reflecting
 *  the tool's effect. Unknown tools no-op with an explanatory message. */
export function applyToolToSnapshot(
  snap: CanvasSnapshot,
  tool: string,
  args: Record<string, unknown>,
): ToolApplyResult {
  const now = Date.now();
  const recordTool = (ok: boolean): ToolCallRecord => ({
    t: 0,
    tool,
    args,
    ok,
  });

  switch (tool) {
    case "open_window": {
      const kind = args.kind as RoomKind;
      const mount = (args.mount as MountPoint | undefined) ?? "full";
      // Already open and not minimized? bring to front.
      const existing = snap.windows.find((w) => w.kind === kind);
      if (existing) {
        const z = nextZ(snap);
        const next: CanvasSnapshot = {
          ...snap,
          windows: snap.windows.map((w) =>
            w.id === existing.id ? { ...w, zIndex: z, mount, rect: rectForMount(mount) } : w,
          ),
          recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
        };
        return {
          snapshot: withFocus(next),
          message: `Brought existing ${kind} to front at ${mount}.`,
        };
      }
      const id = nextServerId();
      const z = nextZ(snap);
      const win: WindowSnapshot = {
        id,
        kind,
        mount,
        rect: rectForMount(mount),
        zIndex: z,
        focused: true,
        openedAt: now,
        summary: "",
      };
      const next: CanvasSnapshot = {
        ...snap,
        windows: [...snap.windows, win],
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return {
        snapshot: withFocus(next),
        message: `Opened ${kind} at ${mount}.`,
      };
    }

    case "close_window": {
      const target = findWindow(snap, {
        id: args.id as string | undefined,
        kind: args.kind as RoomKind | undefined,
      });
      if (!target) {
        return {
          snapshot: {
            ...snap,
            recentActions: recordIntoRing(snap.recentActions, recordTool(false)),
          },
          message: "No window matched the close request.",
        };
      }
      const next: CanvasSnapshot = {
        ...snap,
        windows: snap.windows.filter((w) => w.id !== target.id),
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return {
        snapshot: withFocus(next),
        message: `Closed ${target.kind}.`,
      };
    }

    case "move_window": {
      const target = findWindow(snap, {
        id: args.id as string | undefined,
        kind: args.kind as RoomKind | undefined,
      });
      const mount = args.mount as MountPoint;
      if (!target || !mount) {
        return {
          snapshot: {
            ...snap,
            recentActions: recordIntoRing(snap.recentActions, recordTool(false)),
          },
          message: "move_window needs an existing window and a mount.",
        };
      }
      const next: CanvasSnapshot = {
        ...snap,
        windows: snap.windows.map((w) =>
          w.id === target.id ? { ...w, mount, rect: rectForMount(mount) } : w,
        ),
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return {
        snapshot: withFocus(next),
        message: `Moved ${target.kind} to ${mount}.`,
      };
    }

    case "focus_window": {
      const target = findWindow(snap, {
        id: args.id as string | undefined,
        kind: args.kind as RoomKind | undefined,
      });
      if (!target) {
        return {
          snapshot: {
            ...snap,
            recentActions: recordIntoRing(snap.recentActions, recordTool(false)),
          },
          message: "No window matched the focus request.",
        };
      }
      const z = nextZ(snap);
      const next: CanvasSnapshot = {
        ...snap,
        windows: snap.windows.map((w) =>
          w.id === target.id ? { ...w, zIndex: z } : w,
        ),
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return {
        snapshot: withFocus(next),
        message: `Focused ${target.kind}.`,
      };
    }

    case "arrange_windows": {
      const layout = args.layout as keyof typeof PRESET_TO_MOUNTS;
      const builder = PRESET_TO_MOUNTS[layout];
      if (!builder || snap.windows.length === 0) {
        return {
          snapshot: {
            ...snap,
            recentActions: recordIntoRing(snap.recentActions, recordTool(false)),
          },
          message: `arrange_windows: unknown preset or empty canvas.`,
        };
      }
      const mounts = builder(snap.windows.length);
      // Apply mount[i] to windows sorted by openedAt ascending.
      const ordered = [...snap.windows].sort((a, b) => a.openedAt - b.openedAt);
      const byId = new Map(ordered.map((w, i) => [w.id, mounts[i]]));
      const next: CanvasSnapshot = {
        ...snap,
        windows: snap.windows.map((w) => {
          const m = byId.get(w.id);
          if (!m) return w;
          return { ...w, mount: m, rect: rectForMount(m) };
        }),
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return {
        snapshot: withFocus(next),
        message: `Arranged ${snap.windows.length} windows as ${layout}.`,
      };
    }

    case "clear_canvas": {
      const next: CanvasSnapshot = {
        ...snap,
        windows: [],
        focusedId: null,
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return { snapshot: next, message: "Canvas cleared." };
    }

    /* --- content tools: don't mutate the canvas, just record + surface
     *     a message so the agent's loop sees evidence the tool ran. */
    case "push_card":
    case "highlight":
    case "explain":
    case "compare":
    case "draft":
    case "speak":
    case "graph_focus_node":
    case "graph_zoom_fit":
    case "graph_select":
    case "graph_neighbors":
    case "graph_path":
    case "graph_filter_layer":
    case "graph_filter_integration":
    case "graph_search":
    case "graph_clear":
      return {
        snapshot: {
          ...snap,
          recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
        },
        message: `${tool} dispatched.`,
      };

    default:
      return {
        snapshot: {
          ...snap,
          recentActions: recordIntoRing(snap.recentActions, recordTool(false)),
        },
        message: `Unknown tool ${tool}.`,
      };
  }
}

/** Format a snapshot as the agent-facing user message. The agent sees
 *  this on the first turn; sub-agents see their delegated intent + the
 *  current snapshot at the top of every step. Keeps the model anchored
 *  on real state instead of hallucinating layout. */
export function snapshotToPrompt(snap: CanvasSnapshot): string {
  const lines: string[] = [];
  lines.push(`<canvas viewport=${snap.viewport.w}x${snap.viewport.h}>`);
  lines.push("");
  lines.push("grid (12 cols × 8 rows, uppercase=focused, lowercase=open, ·=empty):");
  lines.push(snap.grid);
  lines.push("");
  if (snap.windows.length === 0) {
    lines.push("windows: (none)");
  } else {
    lines.push("windows:");
    for (const w of snap.windows) {
      lines.push(
        `  - id=${w.id} kind=${w.kind} mount=${w.mount} z=${w.zIndex} focused=${w.focused}` +
          (w.summary ? ` summary="${w.summary}"` : ""),
      );
    }
  }
  if (snap.recentActions.length > 0) {
    lines.push("");
    lines.push("recent actions (most recent last):");
    for (const a of snap.recentActions) {
      lines.push(
        `  - ${a.tool}(${JSON.stringify(a.args)}) → ${a.ok ? "ok" : "fail"}`,
      );
    }
  }
  lines.push("</canvas>");
  return lines.join("\n");
}
