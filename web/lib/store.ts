"use client";

import { create } from "zustand";
import {
  applyCanvasAction,
  findCanvasWindow,
  topWindow,
  type CanvasAction,
  type CanvasState,
  type CanvasWindow,
  type LayoutPreset,
} from "./agent/canvas-reducer";
import type { RectPct } from "./agent/types";

/**
 * Window kinds, schema-driven (v2).
 *
 * Every kind here corresponds to a concrete `/api/kg/*` endpoint (or a
 * cross-cutting UX primitive: `graph`, `chat`, `ask_user`, `settings`).
 * The legacy harness-flavoured kinds have been removed because the KG
 * contract has no endpoint backing them; if a code-execution surface returns later, add a new kind
 * once the endpoint is part of the contract.
 */
export type WindowKind =
  // cross-cutting
  | "graph"
  | "chat"
  | "ask_user"
  | "settings"
  // schema-backed
  | "profile"
  | "integrations"
  | "integration_detail"
  | "entities"
  | "entity_detail"
  | "memories"
  | "skills"
  | "workflows"
  | "wiki"
  | "chats_summary"
  | "composio_connect";

/** Backward-compat alias — consumers migrating to WindowKind. */
export type RoomKind = WindowKind;
export type RoomName = WindowKind;

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

export type WindowState = CanvasWindow;

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

export type { LayoutPreset } from "./agent/canvas-reducer";

export type RoomState =
  | "ready"
  | "loading"
  | "empty"
  | "error"
  | "thinking"
  | "speaking"
  | "deploying"
  | "approval-success";

/** Confirm gate — staged destructive tool call awaiting user approval. */
export interface ConfirmIntent {
  id: string;
  toolName: string;
  description: string;
  stagedAt: number;
  args: Record<string, unknown>;
}

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

/* --- Backend mirrors (for snapshot + UI) --- */

export type ConnectionStatus =
  | "INITIATED"
  | "ACTIVE"
  | "EXPIRED"
  | "FAILED";

export interface BackendHealthMirror {
  surrealOk: boolean;
  composioOk: boolean;
  composioConfigured: boolean;
  /** ms since epoch when the probe was checked. */
  checkedAt: number;
}

/* --- Chat mode --- */

export type UiMode = "windowed" | "chat";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  ts: number;
  /** Which room is in focus when this message is sent/received.
   *  Used to render a small context tag in the message list. */
  room?: RoomKind;
  status?: "streaming" | "done";
}

export interface AgentStoreState {
  /* --- onboarding --- */
  onboarded: boolean;
  setOnboarded: (v: boolean) => void;

  /* --- ui mode --- */
  uiMode: UiMode;
  setUiMode: (mode: UiMode) => void;
  toggleUiMode: () => void;

  /* --- org scaffold (Phase 1) --- */
  orgId: string | null;
  setOrgId: (id: string | null) => void;

  /* --- agency primitives --- */
  quietMode: boolean;
  setQuietMode: (q: boolean) => void;
  confirmQueue: ConfirmIntent[];
  stageConfirm: (intent: ConfirmIntent) => void;
  resolveConfirm: (id: string, approved: boolean) => void;

  /* --- window pinning --- */
  pinWindow: (id: string) => void;
  unpinWindow: (id: string) => void;

  /* --- backend identity & connectivity ---
   *
   * `userId` is the single source of truth for the user's namespace
   * key. Composio routes require it; KG read endpoints currently
   * ignore it (single-tenant in v1) but we still attach it as the
   * `X-User-Id` header on every request so the day the backend goes
   * per-user, no UI changes are needed. Defaults to "default" and is
   * persisted to localStorage by `StoreBridge`. */
  userId: string;
  setUserId: (id: string | null) => void;
  /** Live composio connection status mirror — kept fresh by the
   *  IntegrationRoom and a 30s background poll. Surfaced into the
   *  agent's snapshot so it can answer "is slack connected?" without
   *  burning a tool call. */
  connections: { slug: string; status: ConnectionStatus }[];
  setConnections: (c: { slug: string; status: ConnectionStatus }[]) => void;
  /** Discovered Composio toolkits with auth_scheme so the UI can pick
   *  the right connect flow (OAuth popup vs API-key form). Hydrated
   *  once on mount by StoreBridge. */
  toolkits: { slug: string; name: string; auth_scheme: string; expected_input_fields: { name: string; display_name: string; description: string; type: string; required: boolean }[] }[];
  setToolkits: (t: { slug: string; name: string; auth_scheme: string; expected_input_fields: { name: string; display_name: string; description: string; type: string; required: boolean }[] }[]) => void;
  /** Most recent /api/health probe. Used by the SettingsRoom badge and
   *  surfaced into the snapshot so the agent can mention degraded
   *  mode. `null` while the first probe is in flight. */
  backendHealth: BackendHealthMirror | null;
  setBackendHealth: (h: BackendHealthMirror | null) => void;

  /* --- chat mode --- */
  chatRoom: RoomKind;
  setChatRoom: (room: RoomKind) => void;
  chatMessages: ChatMessage[];
  appendChatMessage: (m: ChatMessage) => void;
  appendToLastAgentMessage: (chunk: string) => void;
  finalizeLastAgentMessage: () => void;
  clearChatHistory: () => void;

  /* --- modal stack (legacy, still wired for backward compat) --- */
  modals: Modal[];
  openRoom: (kind: RoomKind, payload?: Record<string, unknown>) => void;
  closeModal: (id: string) => void;
  closeTopModal: () => void;
  promoteModal: (id: string) => void;
  updateModalPosition: (id: string, pos: { x: number; y: number } | Corner) => void;

  /* --- Stage Manager: windows --- */
  windows: WindowState[];
  dispatchCanvas: (action: CanvasAction) => void;
  /** ms-since-mount origin used for relative `openedAt`. Set lazily
   *  on the first window open or by `resetCanvasClock()`. */
  canvasT0: number;
  /** Ring buffer of recent agent tool calls. Capped by `pushAction`
   *  to keep the snapshot payload bounded. */
  recentActions: ActionRecord[];
  pushAction: (record: ActionRecord, cap?: number) => void;
  clearActions: () => void;
  openWindow: (kind: RoomKind, opts?: { mount?: CanvasWindow["mount"]; payload?: Record<string, unknown>; openedBy?: CanvasWindow["openedBy"]; at?: number }) => string;
  closeWindow: (id: string) => void;
  bringToFront: (id: string) => void;
  arrangeWindows: (layout: LayoutPreset) => void;
  closeTopWindow: () => void;
  updateWindowRect: (id: string, rect: RectPct) => void;

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

  /* --- org scaffold --- */
  orgId: null,
  setOrgId: (id) => set({ orgId: id }),

  /* --- agency primitives --- */
  quietMode: false,
  setQuietMode: (q) => set({ quietMode: q }),
  confirmQueue: [],
  stageConfirm: (intent) =>
    set((s) => ({ confirmQueue: [...s.confirmQueue, intent] })),
  resolveConfirm: (id, approved) =>
    set((s) => ({
      confirmQueue: s.confirmQueue.filter((c) => c.id !== id),
    })),

  /* --- window pinning --- */
  pinWindow: (id) => get().dispatchCanvas({ type: "pin", id, pinned: true }),
  unpinWindow: (id) => get().dispatchCanvas({ type: "pin", id, pinned: false }),

  /* --- ui mode --- */
  uiMode: "windowed",
  setUiMode: (mode) => {
    const state = get();
    const hasChatWindow = state.windows.some(
      (window) => window.kind === state.chatRoom,
    );
    get().dispatchCanvas({ type: "set_mode", mode });
    if (mode === "windowed" && !hasChatWindow) {
      queueMicrotask(() => {
        const current = useAgentStore.getState();
        if (current.uiMode === "windowed") current.openWindow(current.chatRoom);
      });
    }
  },
  toggleUiMode: () => {
    const next: UiMode = get().uiMode === "windowed" ? "chat" : "windowed";
    get().setUiMode(next);
  },

  /* --- backend identity & connectivity --- */
  userId: "default",
  setUserId: (id) => set({ userId: id?.trim() || "default" }),
  connections: [],
  setConnections: (connections) => set({ connections }),
  toolkits: [],
  setToolkits: (toolkits) => set({ toolkits }),
  backendHealth: null,
  setBackendHealth: (backendHealth) => set({ backendHealth }),

  /* --- chat mode --- */
  chatRoom: "chat",
  setChatRoom: (room) => set({ chatRoom: room, room }),
  chatMessages: [],
  appendChatMessage: (m) => {
    set((s) => ({ chatMessages: [...s.chatMessages, m] }));
    // Fire-and-forget persistence to /api/kg/chats. The helper
    // dedupes on `source_id = msg.id` server-side so retries (or
    // duplicate appends from the orchestrator + voice paths) don't
    // double-write. Only finalised messages are persisted; streaming
    // chunks are upserted on `finalizeLastAgentMessage`.
    if (m.text.trim() && m.status !== "streaming") {
      void import("./chat-persistence").then(({ persistChatMessage }) => {
        const userId = (get() as { userId: string }).userId;
        void persistChatMessage(m, userId);
      });
    }
  },
  appendToLastAgentMessage: (chunk) =>
    set((s) => {
      const list = s.chatMessages;
      // Find the last agent message; append chunk to it.
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === "agent") {
          const next = list.slice();
          next[i] = {
            ...list[i],
            text: list[i].text + chunk,
            status: "streaming",
          };
          return { chatMessages: next };
        }
      }
      return s;
    }),
  finalizeLastAgentMessage: () => {
    let finalised: ChatMessage | null = null;
    set((s) => {
      const list = s.chatMessages;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === "agent") {
          const next = list.slice();
          next[i] = { ...list[i], status: "done" };
          finalised = next[i];
          return { chatMessages: next };
        }
      }
      return s;
    });
    // Persist the finished agent reply now that streaming chunks have
    // been collapsed into the final text. agent-client.ts also calls
    // persistChatTurn but going through the store keeps voice-path
    // replies covered without requiring every caller to opt in.
    if (finalised && (finalised as ChatMessage).text.trim()) {
      void import("./chat-persistence").then(({ persistChatMessage }) => {
        const userId = (get() as { userId: string }).userId;
        void persistChatMessage(finalised as ChatMessage, userId);
      });
    }
  },
  clearChatHistory: () => set({ chatMessages: [] }),

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
  canvasT0: 0,
  recentActions: [],

  dispatchCanvas: (action) => {
    const current = get();
    const viewport = {
      w: typeof window !== "undefined" ? window.innerWidth : 1440,
      h: typeof window !== "undefined" ? window.innerHeight : 900,
    };
    const canvas: CanvasState = {
      windows: current.windows,
      mode: current.uiMode,
      viewport,
    };
    const next = applyCanvasAction(canvas, action);
    if (next === canvas) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const records: ActionRecord[] = [];
    if (action.type === "open") {
      if (!current.windows.some((window) => window.kind === action.kind)) {
        records.push({
          t: now,
          tool: "open_window",
          args: { kind: action.kind },
          ok: true,
        });
      }
      for (const window of current.windows) {
        if (!next.windows.some((candidate) => candidate.id === window.id)) {
          records.push({
            t: now,
            tool: "close_window",
            args: { kind: window.kind, id: window.id, reason: "chat-single-focus" },
            ok: true,
          });
        }
      }
    } else if (action.type === "close") {
      const target = action.id || action.kind
        ? findCanvasWindow(canvas, { id: action.id, kind: action.kind })
        : topWindow(current.windows);
      if (target) {
        records.push({
          t: now,
          tool: "close_window",
          args: { kind: target.kind, id: target.id },
          ok: true,
        });
      }
    } else if (action.type === "clear") {
      for (const window of current.windows) {
        records.push({
          t: now,
          tool: "close_window",
          args: { kind: window.kind, id: window.id },
          ok: true,
        });
      }
    } else if (action.type === "arrange") {
      records.push({
        t: now,
        tool: "arrange_windows",
        args: { layout: action.layout },
        ok: true,
      });
    }

    const top = topWindow(next.windows);
    const recentActions = [...current.recentActions, ...records].slice(-6);
    set({
      windows: next.windows,
      uiMode: next.mode,
      ...(top ? { room: top.kind } : {}),
      ...(next.mode === "chat" && top ? { chatRoom: top.kind } : {}),
      recentActions,
      ...(action.type === "open" && current.canvasT0 === 0
        ? { canvasT0: action.at ?? now }
        : {}),
    });
  },

  pushAction: (record, cap = 6) =>
    set((s) => {
      const next = [...s.recentActions, record];
      // Keep most-recent `cap` entries.
      const trimmed = next.length > cap ? next.slice(next.length - cap) : next;
      return { recentActions: trimmed };
    }),
  clearActions: () => set({ recentActions: [] }),

  openWindow: (kind, opts) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const payload = opts?.payload;
    get().dispatchCanvas({
      type: "open",
      kind,
      ...(opts?.mount ? { mount: opts.mount } : {}),
      payload,
      openedBy: opts?.openedBy ?? (payload?.openedBy as "agent" | "user") ?? "user",
      at: opts?.at ?? now,
    });
    return get().windows.find((window) => window.kind === kind)?.id ?? `win-${kind}`;
  },

  closeWindow: (id) => get().dispatchCanvas({ type: "close", id }),
  bringToFront: (id) => get().dispatchCanvas({ type: "focus", id }),
  arrangeWindows: (layout) => get().dispatchCanvas({ type: "arrange", layout }),
  closeTopWindow: () => get().dispatchCanvas({ type: "close" }),
  updateWindowRect: (id, rect) => get().dispatchCanvas({ type: "set_rect", id, rect }),

  room: "chat",
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
