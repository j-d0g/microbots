"use client";

import { create } from "zustand";

export type RoomKind =
  | "brief"
  | "graph"
  | "workflow"
  | "stack"
  | "waffle"
  | "playbooks"
  | "settings";

/** Keep backward compat alias */
export type RoomName = RoomKind;

export type DockState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "hidden";

export type CardKind = "memory" | "entity" | "source" | "diff" | "toast";

export type ModalDisplay = "fullscreen" | "pip";

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface Modal {
  id: string;
  kind: RoomKind;
  display: ModalDisplay;
  position?: { x: number; y: number } | Corner;
  payload?: Record<string, unknown>;
}

/* --- Stage Manager: agent-controlled windows --- */

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowState {
  id: string;
  kind: RoomKind;
  rect: WindowRect;
  zIndex: number;
  minimized: boolean;
  payload?: Record<string, unknown>;
  /** ms since canvas mount when the window was opened. Powers the
   *  `openedAt` field in `CanvasSnapshot.windows[]`. */
  openedAt: number;
}

/** Mirrors `lib/agent/types.ts#ToolCallRecord`. Local copy avoids a
 *  circular import — `snapshot.ts` imports the store, so the store
 *  cannot import `snapshot.ts` types. */
export interface ActionRecord {
  /** Absolute ms timestamp when the action ran (snapshot translates
   *  this to a relative "ms ago" before sending to the agent). */
  t: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export type LayoutPreset = "focus" | "split" | "grid" | "stack-right";

const MIN_SIZES: Record<RoomKind, { w: number; h: number }> = {
  brief: { w: 400, h: 360 },
  graph: { w: 480, h: 400 },
  workflow: { w: 400, h: 320 },
  stack: { w: 400, h: 320 },
  waffle: { w: 360, h: 300 },
  playbooks: { w: 520, h: 360 },
  settings: { w: 400, h: 320 },
};

export function getMinSize(kind: RoomKind) { return MIN_SIZES[kind]; }

/** The dock floats over windows now (translucent), so windows are
 *  allowed to extend all the way to the viewport bottom. We still keep
 *  a small visual reserve so a fully-bottom window doesn't sit behind
 *  the dock pill by default. */
const DOCK_VISUAL_RESERVE = 24;
/** Outer breathing room from the browser viewport edges. Small,
 *  proportional to the chrome — windows feel "anchored on a stage"
 *  rather than glued to the screen edge. Applied to user-driven
 *  drag/resize via `clampToBounds`; the agent's named mounts honour
 *  the same value via `OUTER` in `lib/agent/server-snapshot.ts`. */
const CANVAS_INSET_PX = 16;
/** Legacy gap used by the offline `arrangeWindows` reducer below. Kept
 *  in sync with `CANVAS_INSET_PX` so the two paths look identical. */
const GAP = CANVAS_INSET_PX;

/**
 * Clamp a window rect to the visible viewport so windows can never
 * clip out of the canvas (off-screen right/bottom or behind the dock
 * reserve). Used both by user-drag/resize and by agent-driven layout
 * events — defense in depth, since the agent's px math is computed
 * against the snapshot viewport which can drift if the user resizes
 * the browser between the snapshot and the apply.
 *
 * Also enforces a small CANVAS_INSET_PX margin on every edge so a
 * dragged window never sits flush to the browser chrome.
 */
export function clampToBounds(
  rect: WindowRect,
  kind: RoomKind,
  viewport?: { w: number; h: number },
): WindowRect {
  const vw =
    viewport?.w ?? (typeof window !== "undefined" ? window.innerWidth : 1440);
  const vh =
    viewport?.h ?? (typeof window !== "undefined" ? window.innerHeight : 900);
  const usableH = Math.max(200, vh - DOCK_VISUAL_RESERVE);
  const min = MIN_SIZES[kind];

  // Size: never smaller than min, never larger than (viewport - 2*inset).
  const maxW = Math.max(min.w, vw - 2 * CANVAS_INSET_PX);
  const maxH = Math.max(min.h, usableH - 2 * CANVAS_INSET_PX);
  const w = Math.max(min.w, Math.min(rect.w, maxW));
  const h = Math.max(min.h, Math.min(rect.h, maxH));
  // Position: keep the whole rect on-screen, with INSET on every edge.
  const x = Math.max(
    CANVAS_INSET_PX,
    Math.min(rect.x, vw - CANVAS_INSET_PX - w),
  );
  const y = Math.max(
    CANVAS_INSET_PX,
    Math.min(rect.y, usableH - CANVAS_INSET_PX - h),
  );
  return { x, y, w, h };
}

export type RoomState =
  | "ready"
  | "loading"
  | "empty"
  | "error"
  | "thinking"
  | "speaking"
  | "deploying"
  | "approval-success";

export interface AgentCard {
  id: string;
  kind: CardKind;
  data: Record<string, unknown>;
  ttl?: number;
  createdAt: number;
}

export interface VerbPayload {
  verb: "highlight" | "explain" | "compare" | "draft" | "defer" | "confirm";
  args: Record<string, unknown>;
  at: number;
}

export interface AgentStoreState {
  /* --- onboarding --- */
  onboarded: boolean;
  setOnboarded: (v: boolean) => void;

  /* --- modal stack (legacy, still wired for backward compat) --- */
  modals: Modal[];
  openRoom: (kind: RoomKind, payload?: Record<string, unknown>) => void;
  closeModal: (id: string) => void;
  closeTopModal: () => void;
  promoteModal: (id: string) => void;
  updateModalPosition: (id: string, pos: { x: number; y: number } | Corner) => void;

  /* --- Stage Manager: windows --- */
  windows: WindowState[];
  nextZ: number;
  /** ms-since-mount origin used for relative `openedAt`. Set lazily
   *  on the first window open or by `resetCanvasClock()`. */
  canvasT0: number;
  /** Ring buffer of recent agent tool calls. Capped by `pushAction`
   *  to keep the snapshot payload bounded. */
  recentActions: ActionRecord[];
  pushAction: (record: ActionRecord, cap?: number) => void;
  clearActions: () => void;
  openWindow: (kind: RoomKind, opts?: { rect?: Partial<WindowRect>; payload?: Record<string, unknown> }) => string;
  closeWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  bringToFront: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  arrangeWindows: (layout: LayoutPreset) => void;
  closeTopWindow: () => void;
  updateWindowRect: (id: string, rect: Partial<WindowRect>) => void;

  /* --- legacy room (kept for agent-router compat) --- */
  room: RoomKind;
  roomSlug: string | null;
  setRoom: (room: RoomKind) => void;
  setRoomSlug: (slug: string | null) => void;

  /* --- dock --- */
  dock: DockState;
  setDock: (dock: DockState) => void;

  /* --- cards --- */
  cards: AgentCard[];
  pushCard: (card: Omit<AgentCard, "createdAt">) => void;
  dismissCard: (id: string) => void;

  /* --- transcript --- */
  transcript: string;
  appendTranscript: (chunk: string) => void;
  clearTranscript: () => void;

  /* --- verbs --- */
  lastVerb: VerbPayload | null;
  emitVerb: (verb: VerbPayload) => void;

  /* --- agent status --- */
  agentStatus: string;
  setAgentStatus: (status: string) => void;

  /* --- command bar reply --- */
  agentReply: string;
  commandOpen: boolean;
  lastQuery: string;
  startReply: (query: string) => void;
  appendReply: (chunk: string) => void;
  clearReply: () => void;
  setCommandOpen: (open: boolean) => void;

  /* --- room states --- */
  roomStates: Partial<Record<RoomKind, RoomState>>;
  setRoomState: (room: RoomKind, state: RoomState) => void;
}

const MAX_VISIBLE_CARDS = 3;

let _modalId = 0;
const nextModalId = () => `modal-${++_modalId}`;

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  onboarded: false,
  setOnboarded: (v) => set({ onboarded: v }),

  modals: [],
  openRoom: (kind, payload) => {
    const s = get();
    // If this room is already open fullscreen, skip
    const existing = s.modals.find((m) => m.kind === kind && m.display === "fullscreen");
    if (existing) return;

    // Demote current fullscreen to pip
    const updated = s.modals.map((m) =>
      m.display === "fullscreen"
        ? { ...m, display: "pip" as const, position: "bottom-right" as Corner }
        : m,
    );

    const modal: Modal = {
      id: nextModalId(),
      kind,
      display: "fullscreen",
      payload,
    };

    set({ modals: [...updated, modal], room: kind });
  },

  closeModal: (id) =>
    set((s) => {
      const next = s.modals.filter((m) => m.id !== id);
      // If we closed the fullscreen, promote the last pip
      const hasFullscreen = next.some((m) => m.display === "fullscreen");
      if (!hasFullscreen && next.length > 0) {
        const last = next[next.length - 1];
        return {
          modals: next.map((m) =>
            m.id === last.id ? { ...m, display: "fullscreen" as const } : m,
          ),
          room: last.kind,
        };
      }
      return { modals: next };
    }),

  closeTopModal: () => {
    const s = get();
    const fullscreen = s.modals.find((m) => m.display === "fullscreen");
    if (fullscreen) {
      s.closeModal(fullscreen.id);
    } else if (s.modals.length > 0) {
      s.closeModal(s.modals[s.modals.length - 1].id);
    }
  },

  promoteModal: (id) =>
    set((s) => ({
      modals: s.modals.map((m) => {
        if (m.id === id) return { ...m, display: "fullscreen" as const, position: undefined };
        if (m.display === "fullscreen")
          return { ...m, display: "pip" as const, position: "bottom-right" as Corner };
        return m;
      }),
      room: s.modals.find((m) => m.id === id)?.kind ?? s.room,
    })),

  updateModalPosition: (id, pos) =>
    set((s) => ({
      modals: s.modals.map((m) => (m.id === id ? { ...m, position: pos } : m)),
    })),

  /* --- Stage Manager: windows --- */
  windows: [],
  nextZ: 1,
  canvasT0: 0,
  recentActions: [],

  pushAction: (record, cap = 6) =>
    set((s) => {
      const next = [...s.recentActions, record];
      // Keep most-recent `cap` entries.
      const trimmed = next.length > cap ? next.slice(next.length - cap) : next;
      return { recentActions: trimmed };
    }),
  clearActions: () => set({ recentActions: [] }),

  openWindow: (kind, opts) => {
    const s = get();
    const existing = s.windows.find((w) => w.kind === kind && !w.minimized);
    if (existing) {
      s.bringToFront(existing.id);
      return existing.id;
    }

    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const min = MIN_SIZES[kind];
    const dw = Math.max(opts?.rect?.w ?? Math.min(640, vw - GAP * 2), min.w);
    const dh = Math.max(opts?.rect?.h ?? Math.min(500, vh - DOCK_VISUAL_RESERVE - GAP * 2), min.h);
    const dx = opts?.rect?.x ?? Math.max(GAP, (vw - dw) / 2 + (s.windows.length % 5) * 32);
    const dy = opts?.rect?.y ?? Math.max(GAP, (vh - DOCK_VISUAL_RESERVE - dh) / 2 + (s.windows.length % 5) * 24);

    const id = `win-${++_modalId}`;
    const z = s.nextZ;
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    // Lazily anchor the canvas clock on first window so `openedAt`
    // values stay small and human-readable.
    const t0 = s.canvasT0 || now;
    const win: WindowState = {
      id,
      kind,
      rect: { x: dx, y: dy, w: dw, h: dh },
      zIndex: z,
      minimized: false,
      payload: opts?.payload,
      openedAt: now,
    };
    set({
      windows: [...s.windows, win],
      nextZ: z + 1,
      room: kind,
      canvasT0: t0,
      recentActions: [
        ...s.recentActions,
        { t: now, tool: "open_window", args: { kind }, ok: true },
      ].slice(-6),
    });
    return id;
  },

  closeWindow: (id) =>
    set((s) => {
      const target = s.windows.find((w) => w.id === id);
      const next = s.windows.filter((w) => w.id !== id);
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      return {
        windows: next,
        recentActions: target
          ? [
              ...s.recentActions,
              {
                t: now,
                tool: "close_window",
                args: { kind: target.kind, id },
                ok: true,
              },
            ].slice(-6)
          : s.recentActions,
      };
    }),

  moveWindow: (id, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        // Use full viewport-aware clamp so the window can't be dragged
        // off the right/bottom edge of the canvas.
        const next = clampToBounds({ ...w.rect, x, y }, w.kind);
        return { ...w, rect: next };
      }),
    })),

  resizeWindow: (id, w, h) =>
    set((s) => ({
      windows: s.windows.map((win) => {
        if (win.id !== id) return win;
        return {
          ...win,
          rect: clampToBounds({ ...win.rect, w, h }, win.kind),
        };
      }),
    })),

  bringToFront: (id) =>
    set((s) => {
      const z = s.nextZ;
      return {
        windows: s.windows.map((w) =>
          w.id === id ? { ...w, zIndex: z } : w,
        ),
        nextZ: z + 1,
        room: s.windows.find((w) => w.id === id)?.kind ?? s.room,
      };
    }),

  minimizeWindow: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w,
      ),
    })),

  restoreWindow: (id) => {
    const s = get();
    s.bringToFront(id);
    set((prev) => ({
      windows: prev.windows.map((w) =>
        w.id === id ? { ...w, minimized: false } : w,
      ),
    }));
  },

  closeTopWindow: () => {
    const s = get();
    const visible = s.windows.filter((w) => !w.minimized);
    if (visible.length === 0) return;
    const top = visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
    s.closeWindow(top.id);
  },

  updateWindowRect: (id, rect) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const merged = { ...w.rect, ...rect };
        return { ...w, rect: clampToBounds(merged, w.kind) };
      }),
    })),

  arrangeWindows: (layout) =>
    set((s) => {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const recentActions = [
        ...s.recentActions,
        { t: now, tool: "arrange_windows", args: { layout }, ok: true },
      ].slice(-6);
      const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
      const vh = typeof window !== "undefined" ? window.innerHeight : 768;
      const usable = vh - DOCK_VISUAL_RESERVE;
      const visible = s.windows.filter((w) => !w.minimized);
      if (visible.length === 0) return s;

      let arranged: WindowState[];

      switch (layout) {
        case "focus": {
          const top = visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
          arranged = s.windows.map((w) => {
            if (w.minimized) return w;
            if (w.id === top.id) {
              return { ...w, rect: { x: GAP, y: GAP, w: vw - GAP * 2, h: usable - GAP * 2 } };
            }
            return { ...w, minimized: true };
          });
          break;
        }
        case "split": {
          const half = (vw - GAP * 3) / 2;
          arranged = s.windows.map((w, i) => {
            if (w.minimized) return w;
            const vi = visible.indexOf(w);
            if (vi === -1) return w;
            if (vi < 2) {
              return {
                ...w,
                minimized: false,
                rect: { x: GAP + vi * (half + GAP), y: GAP, w: half, h: usable - GAP * 2 },
              };
            }
            return { ...w, minimized: true };
          });
          break;
        }
        case "grid": {
          const cols = Math.ceil(Math.sqrt(visible.length));
          const rows = Math.ceil(visible.length / cols);
          const cellW = (vw - GAP * (cols + 1)) / cols;
          const cellH = (usable - GAP * (rows + 1)) / rows;
          arranged = s.windows.map((w) => {
            if (w.minimized) return w;
            const vi = visible.indexOf(w);
            if (vi === -1) return w;
            const col = vi % cols;
            const row = Math.floor(vi / cols);
            return {
              ...w,
              minimized: false,
              rect: {
                x: GAP + col * (cellW + GAP),
                y: GAP + row * (cellH + GAP),
                w: cellW,
                h: cellH,
              },
            };
          });
          break;
        }
        case "stack-right": {
          if (visible.length === 1) {
            arranged = s.windows.map((w) => {
              if (w.minimized) return w;
              return { ...w, rect: { x: GAP, y: GAP, w: vw - GAP * 2, h: usable - GAP * 2 } };
            });
          } else {
            const mainW = Math.floor((vw - GAP * 3) * 0.6);
            const sideW = vw - mainW - GAP * 3;
            const sideH = (usable - GAP * (visible.length)) / (visible.length - 1);
            arranged = s.windows.map((w) => {
              if (w.minimized) return w;
              const vi = visible.indexOf(w);
              if (vi === 0) {
                return { ...w, rect: { x: GAP, y: GAP, w: mainW, h: usable - GAP * 2 } };
              }
              return {
                ...w,
                rect: {
                  x: GAP * 2 + mainW,
                  y: GAP + (vi - 1) * (sideH + GAP),
                  w: sideW,
                  h: sideH,
                },
              };
            });
          }
          break;
        }
        default:
          arranged = s.windows;
      }

      return { windows: arranged, recentActions };
    }),

  room: "brief",
  roomSlug: null,
  setRoom: (room) => set({ room }),
  setRoomSlug: (roomSlug) => set({ roomSlug }),

  dock: "idle",
  setDock: (dock) => set({ dock }),

  cards: [],
  pushCard: (card) =>
    set((s) => {
      const next = [
        ...s.cards,
        { ...card, createdAt: Date.now() },
      ].slice(-MAX_VISIBLE_CARDS);
      return { cards: next };
    }),
  dismissCard: (id) =>
    set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),

  transcript: "",
  appendTranscript: (chunk) =>
    set((s) => ({ transcript: s.transcript + chunk })),
  clearTranscript: () => set({ transcript: "" }),

  lastVerb: null,
  emitVerb: (verb) => set({ lastVerb: verb }),

  agentStatus: "",
  setAgentStatus: (agentStatus) => set({ agentStatus }),

  agentReply: "",
  commandOpen: false,
  lastQuery: "",
  startReply: (query) => set({ agentReply: "", lastQuery: query }),
  appendReply: (chunk) => set((s) => ({ agentReply: s.agentReply + chunk })),
  clearReply: () => set({ agentReply: "", lastQuery: "" }),
  setCommandOpen: (open) => set({ commandOpen: open }),

  roomStates: {},
  setRoomState: (room, state) =>
    set((s) => ({ roomStates: { ...s.roomStates, [room]: state } })),
}));

