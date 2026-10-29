import type { AgentEvent } from "@/lib/agent-client";
import { resolveMount } from "./mount-points";
import type { MountPoint, RectPct } from "./types";
import type { WindowKind } from "@/lib/store";

export interface CanvasWindow {
  id: string;
  kind: WindowKind;
  mount: MountPoint;
  rect: RectPct;
  zIndex: number;
  pinned: boolean;
  openedAt: number;
  openedBy?: "agent" | "user";
  payload?: Record<string, unknown>;
}

export interface CanvasState {
  windows: CanvasWindow[];
  mode: "windowed" | "chat";
  viewport: { w: number; h: number };
}

export type LayoutPreset =
  | "focus"
  | "split"
  | "grid"
  | "stack-right"
  | "spotlight"
  | "theater"
  | "reading"
  | "triptych";

export type CanvasAction =
  | { type: "open"; kind: WindowKind; mount?: MountPoint; payload?: Record<string, unknown>; openedBy?: "agent" | "user"; at?: number }
  | { type: "update_payload"; kind: WindowKind; payload: Record<string, unknown> }
  | { type: "close"; id?: string; kind?: WindowKind }
  | { type: "focus"; id?: string; kind?: WindowKind }
  | { type: "move"; id?: string; kind?: WindowKind; mount: MountPoint }
  | { type: "set_rect"; id?: string; kind?: WindowKind; rect: RectPct }
  | { type: "arrange"; layout: LayoutPreset }
  | { type: "pin"; id?: string; kind?: WindowKind; pinned: boolean }
  | { type: "clear" }
  | { type: "set_mode"; mode: "windowed" | "chat" };

export const OUTER = 2.5;
export const GUTTER = 2.5;
const PIP_STRIP_H = 18;

function jitterY(slotIndex: number): number {
  return slotIndex % 2 === 0 ? 1.5 : -1.5;
}

function jitterDiag(slotIndex: number): { dx: number; dy: number } {
  const sign = slotIndex % 2 === 0 ? 1 : -1;
  return { dx: sign * 0.8, dy: sign * 1.2 };
}

function rectFull(): RectPct {
  return { x: OUTER, y: OUTER, w: 100 - 2 * OUTER, h: 100 - 2 * OUTER };
}

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
    if (n <= 1) return [rectFull()];
    const subjectW = 78;
    const subjectH = 100 - 2 * OUTER - GUTTER - PIP_STRIP_H;
    const subject: RectPct = { x: (100 - subjectW) / 2, y: OUTER, w: subjectW, h: subjectH };
    const stripY = OUTER + subjectH + GUTTER;
    const pips = pipRow(n - 1, stripY, PIP_STRIP_H);
    return [subject, ...pips];
  },
  split: (n) => {
    if (n <= 1) return [rectFull()];
    const w = (100 - 2 * OUTER - GUTTER) / 2;
    const h = 100 - 2 * OUTER;
    const left: RectPct = { x: OUTER, y: OUTER + jitterY(0), w, h: h - Math.abs(jitterY(0)) };
    const right: RectPct = { x: OUTER + w + GUTTER, y: OUTER + jitterY(1), w, h: h - Math.abs(jitterY(1)) };
    if (n === 2) return [left, right];
    const stackH = (h - (n - 2) * GUTTER) / (n - 1);
    const sideX = OUTER + w + GUTTER;
    const sides: RectPct[] = [];
    for (let i = 0; i < n - 1; i++) {
      sides.push({
        x: sideX,
        y: OUTER + i * (stackH + GUTTER) + jitterY(i + 1),
        w,
        h: stackH - Math.abs(jitterY(i + 1)),
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
      const j = jitterDiag(i);
      out.push({
        x: OUTER + c * (w + GUTTER) + j.dx,
        y: OUTER + r * (h + GUTTER) + j.dy,
        w: w - Math.abs(j.dx),
        h: h - Math.abs(j.dy),
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
      right.push({ x: sideX, y: OUTER + i * (sideH + GUTTER), w: sideW, h: sideH });
    }
    return [main, ...right];
  },
  spotlight: (n) => {
    if (n <= 1) return [rectFull()];
    const subjectH = 72;
    const subjectW = 70;
    const subject: RectPct = { x: (100 - subjectW) / 2, y: OUTER, w: subjectW, h: subjectH };
    const stripY = OUTER + subjectH + GUTTER;
    const stripH = 100 - 2 * OUTER - subjectH - GUTTER;
    const pips = pipRow(n - 1, stripY, stripH);
    return [subject, ...pips];
  },
  theater: (n) => {
    if (n <= 1) return [rectFull()];
    const topH = 64;
    const subjectW = 82;
    const stripY = OUTER + topH + GUTTER;
    const stripH = 100 - 2 * OUTER - topH - GUTTER;
    const subject: RectPct = { x: (100 - subjectW) / 2, y: OUTER, w: subjectW, h: topH };
    const cols = n - 1;
    const stripW = (100 - 2 * OUTER - (cols - 1) * GUTTER) / cols;
    const strips: RectPct[] = [];
    for (let i = 0; i < cols; i++) {
      strips.push({ x: OUTER + i * (stripW + GUTTER) + jitterY(i) * 0.5, y: stripY, w: stripW, h: stripH });
    }
    return [subject, ...strips];
  },
  reading: (n) => {
    if (n <= 1) return [rectFull()];
    const mainW = 60;
    const sideW = 100 - 2 * OUTER - GUTTER - mainW;
    const h = 100 - 2 * OUTER;
    const main: RectPct = { x: OUTER, y: OUTER, w: mainW, h };
    if (n === 2) return [main, { x: OUTER + mainW + GUTTER, y: OUTER, w: sideW, h }];
    const sides = n - 1;
    const sideH = (h - (sides - 1) * GUTTER) / sides;
    const sideX = OUTER + mainW + GUTTER;
    const sidebar: RectPct[] = [];
    for (let i = 0; i < sides; i++) {
      sidebar.push({ x: sideX, y: OUTER + i * (sideH + GUTTER), w: sideW, h: sideH });
    }
    return [main, ...sidebar];
  },
  triptych: (n) => {
    if (n <= 1) return [rectFull()];
    if (n === 2) return PRESETS.split(2);
    if (n > 3) return PRESETS.grid(n);
    const w = (100 - 2 * OUTER - 2 * GUTTER) / 3;
    const h = 100 - 2 * OUTER;
    return [
      { x: OUTER, y: OUTER + 1.5, w, h: h - 1.5 },
      { x: OUTER + w + GUTTER, y: OUTER, w, h },
      { x: OUTER + 2 * (w + GUTTER), y: OUTER + 2.0, w, h: h - 2.0 },
    ];
  },
};

export const LAYOUT_PRESET_NAMES = [
  "focus",
  "split",
  "grid",
  "stack-right",
  "spotlight",
  "theater",
  "reading",
  "triptych",
] as const satisfies readonly LayoutPreset[];

export function rectsForPreset(layout: LayoutPreset, n: number): RectPct[] {
  return PRESETS[layout](n);
}

export function windowIdForKind(kind: WindowKind): string {
  return `win-${kind}`;
}

export function topWindow(windows: readonly CanvasWindow[]): CanvasWindow | null {
  return windows.reduce<CanvasWindow | null>(
    (top, window) => (!top || window.zIndex > top.zIndex ? window : top),
    null,
  );
}

export function findCanvasWindow(
  stateOrWindows: CanvasState | readonly CanvasWindow[],
  selector: { id?: string; kind?: WindowKind },
): CanvasWindow | null {
  const windows = Array.isArray(stateOrWindows)
    ? stateOrWindows
    : (stateOrWindows as CanvasState).windows;
  if (selector.id) {
    return windows.find((window) => window.id === selector.id) ?? null;
  }
  if (selector.kind) {
    return windows
      .filter((window) => window.kind === selector.kind)
      .reduce<CanvasWindow | null>(
        (top, window) => (!top || window.zIndex > top.zIndex ? window : top),
        null,
      );
  }
  return null;
}

function nextZ(windows: readonly CanvasWindow[]): number {
  return windows.reduce((max, window) => Math.max(max, window.zIndex), 0) + 1;
}

function resolvedRect(mount: MountPoint, viewport: CanvasState["viewport"]): RectPct {
  return resolveMount(mount, viewport);
}

export function applyCanvasAction(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "open": {
      let windows = state.windows;
      if (state.mode === "chat") windows = windows.filter((window) => window.kind === action.kind);
      const existing = windows.find((window) => window.kind === action.kind);
      const mount = action.mount;
      const zIndex = nextZ(windows);
      if (existing) {
        return {
          ...state,
          windows: windows.map((window) =>
            window.id === existing.id
              ? {
                  ...window,
                  ...(action.payload ? { payload: { ...window.payload, ...action.payload } } : {}),
                  zIndex,
                  ...(mount ? { mount, rect: resolvedRect(mount, state.viewport) } : {}),
                  ...(action.openedBy ? { openedBy: action.openedBy } : {}),
                }
              : window,
          ),
        };
      }
      const newMount = mount ?? "full";
      return {
        ...state,
        windows: [
          ...windows,
          {
            id: windowIdForKind(action.kind),
            kind: action.kind,
            mount: newMount,
            rect: resolvedRect(newMount, state.viewport),
            zIndex,
            pinned: false,
            openedAt: action.at ?? 0,
            ...(action.openedBy ? { openedBy: action.openedBy } : {}),
            ...(action.payload ? { payload: action.payload } : {}),
          },
        ],
      };
    }
    case "update_payload": {
      const target = findCanvasWindow(state, { kind: action.kind });
      if (!target) return state;
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === target.id
            ? { ...window, payload: { ...window.payload, ...action.payload } }
            : window,
        ),
      };
    }
    case "close": {
      const target = action.id || action.kind
        ? findCanvasWindow(state, { id: action.id, kind: action.kind })
        : topWindow(state.windows);
      if (!target) return state;
      return { ...state, windows: state.windows.filter((window) => window.id !== target.id) };
    }
    case "focus": {
      const target = findCanvasWindow(state, { id: action.id, kind: action.kind });
      if (!target) return state;
      const zIndex = nextZ(state.windows);
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === target.id ? { ...window, zIndex } : window,
        ),
      };
    }
    case "move": {
      if (state.mode === "chat") return state;
      const target = findCanvasWindow(state, { id: action.id, kind: action.kind });
      if (!target) return state;
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === target.id
            ? { ...window, mount: action.mount, rect: resolvedRect(action.mount, state.viewport) }
            : window,
        ),
      };
    }
    case "set_rect": {
      if (state.mode === "chat") return state;
      const target = findCanvasWindow(state, { id: action.id, kind: action.kind });
      if (!target) return state;
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === target.id ? { ...window, mount: "freeform", rect: action.rect } : window,
        ),
      };
    }
    case "arrange": {
      if (state.mode === "chat") return state;
      const preset = PRESETS[action.layout];
      if (!preset || state.windows.length === 0) return state;
      const rects = preset(state.windows.length);
      const ordered = [...state.windows].sort((a, b) => b.zIndex - a.zIndex);
      const rectById = new Map(ordered.map((window, index) => [window.id, rects[index]]));
      return {
        ...state,
        windows: state.windows.map((window) => {
          const rect = rectById.get(window.id);
          return rect ? { ...window, mount: "freeform", rect } : window;
        }),
      };
    }
    case "pin": {
      const target = findCanvasWindow(state, { id: action.id, kind: action.kind });
      if (!target) return state;
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === target.id ? { ...window, pinned: action.pinned } : window,
        ),
      };
    }
    case "clear":
      return state.windows.length === 0 ? state : { ...state, windows: [] };
    case "set_mode": {
      if (action.mode === "windowed") {
        return state.mode === action.mode ? state : { ...state, mode: action.mode };
      }
      const top = topWindow(state.windows);
      const windows = top ? [top] : [];
      if (state.mode === action.mode && windows.length === state.windows.length) return state;
      return { ...state, mode: action.mode, windows };
    }
  }
}

export function canvasActionForEvent(evt: AgentEvent): CanvasAction | null {
  switch (evt.type) {
    case "ui.canvas":
      return evt.action;
    case "ui.room":
      return {
        type: "open",
        kind: evt.room,
        mount: evt.mount,
        payload: evt.payload,
        openedBy: "agent",
      };
    case "ui.close_window":
      return { type: "close", kind: evt.room };
    case "ui.tool.open":
      return { type: "open", kind: evt.kind, payload: evt.payload, openedBy: "agent" };
    case "ui.tool.update":
      return { type: "update_payload", kind: evt.kind, payload: evt.payload };
    case "ui.tool.done":
      return {
        type: "update_payload",
        kind: evt.kind,
        payload: { ...evt.payload, status: "done" },
      };
    case "ui.ask":
      return {
        type: "open",
        kind: "ask_user",
        payload: { question: evt.question, options: evt.options },
        openedBy: "agent",
      };
    default:
      return null;
  }
}
