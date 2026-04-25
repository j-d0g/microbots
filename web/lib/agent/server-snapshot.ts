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

/* =================================================================
 *  LAYOUT PRESETS — pre-determined geometry. Japanese-negative-space
 *  principles bake in:
 *    OUTER  : breathing room from the canvas edges (~ma 間)
 *    GUTTER : spacing between adjacent windows
 *  All numbers are % of canvas. The agent picks a preset name; the
 *  simulator computes rects. The agent never does math.
 *
 *  Slot[0] is always the SUBJECT — the focused window when a user
 *  triggers an arrangement. Subsequent slots are demoted contexts.
 * ================================================================= */

const OUTER = 2.5;
const GUTTER = 2.5;
const PIP_STRIP_H = 18; // height % reserved for thumbnail rows below a hero

export type LayoutPreset =
  | "focus"
  | "split"
  | "grid"
  | "stack-right"
  | "spotlight"
  | "theater"
  | "reading"
  | "triptych";

function rectFull(): RectPct {
  return { x: OUTER, y: OUTER, w: 100 - 2 * OUTER, h: 100 - 2 * OUTER };
}

/**
 * Layout a row of equal-width thumbnails along a horizontal strip.
 * Used by focus / spotlight to place demoted windows below the
 * subject *without* overlapping its bounds.
 */
function pipRow(count: number, y: number, h: number): RectPct[] {
  const usable = 100 - 2 * OUTER;
  const w = (usable - (count - 1) * GUTTER) / count;
  const out: RectPct[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: OUTER + i * (w + GUTTER), y, w, h });
  }
  return out;
}

const PRESETS: Record<LayoutPreset, (n: number) => RectPct[]> = {
  focus: (n) => {
    // SUBJECT-DOMINANT, no overlap. With one window: full canvas. With
    // many: subject takes the upper region (95×~78), demoted windows
    // sit in a thin strip below — clearly separated by GUTTER.
    if (n <= 1) return [rectFull()];
    const subjectH = 100 - 2 * OUTER - GUTTER - PIP_STRIP_H;
    const subject: RectPct = {
      x: OUTER,
      y: OUTER,
      w: 100 - 2 * OUTER,
      h: subjectH,
    };
    const stripY = OUTER + subjectH + GUTTER;
    const pips = pipRow(n - 1, stripY, PIP_STRIP_H);
    return [subject, ...pips];
  },

  split: (n) => {
    if (n <= 1) return [rectFull()];
    const w = (100 - 2 * OUTER - GUTTER) / 2;
    const h = 100 - 2 * OUTER;
    const left: RectPct = { x: OUTER, y: OUTER, w, h };
    const right: RectPct = { x: OUTER + w + GUTTER, y: OUTER, w, h };
    if (n === 2) return [left, right];
    // n>2: subject left, others stacked on the right.
    const stackH = (h - (n - 2) * GUTTER) / (n - 1);
    const sideX = OUTER + w + GUTTER;
    const sides: RectPct[] = [];
    for (let i = 0; i < n - 1; i++) {
      sides.push({
        x: sideX,
        y: OUTER + i * (stackH + GUTTER),
        w,
        h: stackH,
      });
    }
    return [left, ...sides];
  },

  grid: (n) => {
    if (n <= 1) return [rectFull()];
    if (n === 2) return PRESETS.split(2);
    if (n === 3) return PRESETS.triptych(3);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const w = (100 - 2 * OUTER - (cols - 1) * GUTTER) / cols;
    const h = (100 - 2 * OUTER - (rows - 1) * GUTTER) / rows;
    const out: RectPct[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      out.push({
        x: OUTER + c * (w + GUTTER),
        y: OUTER + r * (h + GUTTER),
        w,
        h,
      });
    }
    return out;
  },

  "stack-right": (n) => {
    if (n <= 1) return [rectFull()];
    const mainW = 62;
    const sideW = 100 - 2 * OUTER - GUTTER - mainW;
    const sideX = OUTER + mainW + GUTTER;
    const totalH = 100 - 2 * OUTER;
    const sides = n - 1;
    const sideH = (totalH - (sides - 1) * GUTTER) / sides;
    const main: RectPct = { x: OUTER, y: OUTER, w: mainW, h: totalH };
    const right: RectPct[] = [];
    for (let i = 0; i < sides; i++) {
      right.push({
        x: sideX,
        y: OUTER + i * (sideH + GUTTER),
        w: sideW,
        h: sideH,
      });
    }
    return [main, ...right];
  },

  spotlight: (n) => {
    // CENTRED HERO + BOTTOM THUMBNAILS, no overlap. Subject is centred
    // (narrower than focus to feel more "stage-like"), demoted windows
    // line up in a strip below.
    if (n <= 1) return [rectFull()];
    const subjectH = 70;
    const subjectW = 64;
    const subject: RectPct = {
      x: (100 - subjectW) / 2,
      y: OUTER,
      w: subjectW,
      h: subjectH,
    };
    const stripY = OUTER + subjectH + GUTTER;
    const stripH = 100 - 2 * OUTER - subjectH - GUTTER;
    const pips = pipRow(n - 1, stripY, stripH);
    return [subject, ...pips];
  },

  theater: (n) => {
    if (n <= 1) return [rectFull()];
    const topH = 64;
    const stripY = OUTER + topH + GUTTER;
    const stripH = 100 - 2 * OUTER - topH - GUTTER;
    const subject: RectPct = {
      x: OUTER,
      y: OUTER,
      w: 100 - 2 * OUTER,
      h: topH,
    };
    const cols = n - 1;
    const stripW = (100 - 2 * OUTER - (cols - 1) * GUTTER) / cols;
    const strips: RectPct[] = [];
    for (let i = 0; i < cols; i++) {
      strips.push({
        x: OUTER + i * (stripW + GUTTER),
        y: stripY,
        w: stripW,
        h: stripH,
      });
    }
    return [subject, ...strips];
  },

  reading: (n) => {
    if (n <= 1) return [rectFull()];
    const mainW = 60;
    const sideW = 100 - 2 * OUTER - GUTTER - mainW;
    const h = 100 - 2 * OUTER;
    const main: RectPct = { x: OUTER, y: OUTER, w: mainW, h };
    if (n === 2) {
      return [
        main,
        { x: OUTER + mainW + GUTTER, y: OUTER, w: sideW, h },
      ];
    }
    // n>2: stack the sidebars vertically.
    const sides = n - 1;
    const sideH = (h - (sides - 1) * GUTTER) / sides;
    const sideX = OUTER + mainW + GUTTER;
    const sidebar: RectPct[] = [];
    for (let i = 0; i < sides; i++) {
      sidebar.push({
        x: sideX,
        y: OUTER + i * (sideH + GUTTER),
        w: sideW,
        h: sideH,
      });
    }
    return [main, ...sidebar];
  },

  triptych: (n) => {
    if (n <= 1) return [rectFull()];
    if (n === 2) return PRESETS.split(2);
    if (n > 3) return PRESETS.grid(n); // triptych is 3-only; degrade to grid
    const w = (100 - 2 * OUTER - 2 * GUTTER) / 3;
    const h = 100 - 2 * OUTER;
    return [
      { x: OUTER, y: OUTER, w, h },
      { x: OUTER + w + GUTTER, y: OUTER, w, h },
      { x: OUTER + 2 * (w + GUTTER), y: OUTER, w, h },
    ];
  },
};

/** Public for tests + tools. Consumers should treat the array as
 *  ordered: rects[0] = subject, rest = demoted slots. */
export function rectsForPreset(layout: LayoutPreset, n: number): RectPct[] {
  return PRESETS[layout](n);
}

/** Layout preset names exposed to the agent. Keep in sync with
 *  LAYOUT_PRESET in `tools.ts`. */
export const LAYOUT_PRESET_NAMES: readonly LayoutPreset[] = [
  "focus",
  "split",
  "grid",
  "stack-right",
  "spotlight",
  "theater",
  "reading",
  "triptych",
];

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
  /** Whether the tool succeeded — mirrors the `ok` recorded in
   *  `recentActions`. Consumers (e.g. `applyAndEmit`) forward this
   *  into `agent.tool.done` so the recovery metric is truthful. */
  ok: boolean;
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
          ok: true,
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
        ok: true,
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
          ok: false,
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
        ok: true,
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
          ok: false,
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
        ok: true,
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
          ok: false,
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
        ok: true,
      };
    }

    case "arrange_windows": {
      const layout = args.layout as LayoutPreset;
      const builder = PRESETS[layout];
      if (!builder || snap.windows.length === 0) {
        return {
          snapshot: {
            ...snap,
            recentActions: recordIntoRing(snap.recentActions, recordTool(false)),
          },
          message: `arrange_windows: unknown preset or empty canvas.`,
          ok: false,
        };
      }
      const rects = builder(snap.windows.length);
      // Subject (slot 0) goes to the focused window — i.e. whichever
      // has the highest zIndex right now. The rest are mapped in
      // descending z order so recent context fills the prominent
      // demoted slots before older windows.
      const ordered = [...snap.windows].sort((a, b) => b.zIndex - a.zIndex);
      const rectById = new Map<string, RectPct>(
        ordered.map((w, i) => [w.id, rects[i]] as const),
      );
      const next: CanvasSnapshot = {
        ...snap,
        windows: snap.windows.map((w) => {
          const r = rectById.get(w.id);
          if (!r) return w;
          return { ...w, mount: "freeform" as MountPoint, rect: r };
        }),
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return {
        snapshot: withFocus(next),
        message: `Arranged ${snap.windows.length} windows as ${layout} (gutter ${GUTTER}%, outer ${OUTER}%).`,
        ok: true,
      };
    }

    case "clear_canvas": {
      const next: CanvasSnapshot = {
        ...snap,
        windows: [],
        focusedId: null,
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return { snapshot: next, message: "Canvas cleared.", ok: true };
    }

    case "set_window_rect": {
      // Free-form positioning — args carry an explicit % rect. The
      // tool wrapper validates ranges; we trust them here.
      const rectPct = args.rect_pct as RectPct | undefined;
      const target = findWindow(snap, {
        id: args.id as string | undefined,
        kind: args.kind as RoomKind | undefined,
      });
      if (!target || !rectPct) {
        return {
          snapshot: {
            ...snap,
            recentActions: recordIntoRing(snap.recentActions, recordTool(false)),
          },
          message: "set_window_rect needs an existing window and a rect.",
          ok: false,
        };
      }
      const next: CanvasSnapshot = {
        ...snap,
        windows: snap.windows.map((w) =>
          w.id === target.id
            ? { ...w, mount: "freeform", rect: rectPct }
            : w,
        ),
        recentActions: recordIntoRing(snap.recentActions, recordTool(true)),
      };
      return {
        snapshot: withFocus(next),
        message: `Resized ${target.kind} to ${rectPct.w.toFixed(0)}×${rectPct.h.toFixed(0)} at (${rectPct.x.toFixed(0)},${rectPct.y.toFixed(0)}).`,
        ok: true,
      };
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
        ok: true,
      };

    default:
      return {
        snapshot: {
          ...snap,
          recentActions: recordIntoRing(snap.recentActions, recordTool(false)),
        },
        message: `Unknown tool ${tool}.`,
        ok: false,
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
