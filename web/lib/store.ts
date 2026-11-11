"use client";

import type { ReplyUsage } from "./agent-client";
import { create } from "zustand";
import {
  applyCanvasAction,
  topWindow,
  type CanvasAction,
  type CanvasState,
  type CanvasWindow,
} from "./agent/canvas-reducer";

/**
 * Window kinds, schema-driven (v2).
 *
 * Every kind here corresponds to a concrete `/api/kg/*` endpoint or a
 * cross-cutting UX primitive such as `graph` or `ask_user`.
 * The legacy harness-flavoured kinds have been removed because the KG
 * contract has no endpoint backing them; if a code-execution surface returns later, add a new kind
 * once the endpoint is part of the contract.
 */
export type WindowKind =
  // cross-cutting
  | "graph"
  | "ask_user"
  // schema-backed
  | "integrations"
  | "integration_detail"
  | "entities"
  | "entity_detail"
  | "memories"
  | "skills"
  | "workflows"
  | "today"
  | "composio_connect";

export type RoomKind = WindowKind;

export type DockState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "hidden";

export type CardKind = "memory" | "entity" | "source" | "diff" | "toast";

export type WindowState = CanvasWindow;

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

/* --- Backend mirrors (for snapshot + UI) --- */

export type ConnectionStatus =
  | "INITIATED"
  | "ACTIVE"
  | "EXPIRED"
  | "FAILED";

export interface BackendHealthMirror {
  apiOk: boolean;
  surrealOk: boolean;
  composioOk: boolean;
  composioConfigured: boolean;
  /** ms since epoch when the probe was checked. */
  checkedAt: number;
}

/* --- Chat mode --- */

export interface ChatCard {
  id: string;
  kind: WindowKind;
  payload?: Record<string, unknown>;
}

export interface ToolTrace {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  startedAt: number;
  ms?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  ts: number;
  /** Which room is in focus when this message is sent or received. */
  room?: RoomKind;
  status?: "streaming" | "done" | "failed" | "stopped";
  cards?: ChatCard[];
  tools?: ToolTrace[];
  /** Tokens spent on this agent reply (all steps); absent for user messages and scripted runs. */
  usage?: ReplyUsage;
}

export interface AgentStoreState {
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
  /** Most recent /api/health probe. Used by the Settings page and
   *  surfaced into the snapshot so the agent can mention degraded
   *  mode. `null` while the first probe is in flight. */
  backendHealth: BackendHealthMirror | null;
  setBackendHealth: (h: BackendHealthMirror | null) => void;

  /* --- chat --- */
  chatRoom: RoomKind;
  setChatRoom: (room: RoomKind) => void;
  chatCanvasOpen: boolean;
  openChatCanvas: (kind: RoomKind, payload?: Record<string, unknown>) => void;
  closeChatCanvas: () => void;
  chatMessages: ChatMessage[];
  appendChatMessage: (m: ChatMessage) => void;
  setChatMessageStatus: (
    id: string,
    status: NonNullable<ChatMessage["status"]>,
  ) => void;
  getOrCreateStreamingAgentMessage: () => ChatMessage;
  appendToLastAgentMessage: (chunk: string) => void;
  attachChatCard: (kind: WindowKind, payload?: Record<string, unknown>) => void;
  answerChatCard: (cardId: string, answer: string) => void;
  startChatToolTrace: (name: string, args?: Record<string, unknown>) => void;
  finishChatToolTrace: (name: string, ok: boolean) => void;
  finalizeLastAgentMessage: (status?: "done" | "stopped", usage?: ReplyUsage) => void;
  clearChatHistory: () => void;

  /* --- canvas cards --- */
  windows: WindowState[];
  dispatchCanvas: (action: CanvasAction) => void;
  openWindow: (kind: RoomKind, opts?: { payload?: Record<string, unknown>; openedBy?: CanvasWindow["openedBy"]; at?: number }) => string;
  closeWindow: (id: string) => void;
  bringToFront: (id: string) => void;
  closeTopWindow: () => void;

  /* --- active room context --- */
  room: RoomKind;
  setRoom: (room: RoomKind) => void;

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

  /* --- agent status --- */
  agentStatus: string;
  setAgentStatus: (status: string) => void;

  /* --- reply state --- */
  agentReply: string;
  lastQuery: string;
  startReply: (query: string) => void;
  appendReply: (chunk: string) => void;
  clearReply: () => void;
  /* --- room states --- */
  roomStates: Partial<Record<RoomKind, RoomState>>;
  setRoomState: (room: RoomKind, state: RoomState) => void;

}

const MAX_VISIBLE_CARDS = 3;

export const useAgentStore = create<AgentStoreState>((set, get) => ({
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
  chatRoom: "graph",
  setChatRoom: (room) => set({ chatRoom: room, room }),
  chatCanvasOpen: false,
  openChatCanvas: (kind, payload) => {
    const existing = get().windows.find((window) => window.kind === kind);
    if (existing) {
      if (payload) {
        get().dispatchCanvas({
          type: "open",
          kind,
          payload,
          openedBy: existing.openedBy,
        });
      } else {
        get().bringToFront(existing.id);
      }
    } else {
      get().openWindow(kind, { payload });
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.get("canvas") !== kind) {
        url.searchParams.set("canvas", kind);
        window.history.pushState(
          { ...window.history.state, microbotsCanvas: true },
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    }
    set({ chatRoom: kind, room: kind, chatCanvasOpen: true });
  },
  closeChatCanvas: () => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("canvas")) {
        if (window.history.state?.microbotsCanvas) {
          window.history.back();
          return;
        }
        url.searchParams.delete("canvas");
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    }
    set({ chatCanvasOpen: false });
  },
  chatMessages: [],
  appendChatMessage: (m) => {
    set((s) => ({ chatMessages: [...s.chatMessages, m] }));
    if (m.text.trim() && m.status !== "streaming") {
      void import("./chat-persistence").then(({ persistChatMessage }) => {
        const userId = (get() as { userId: string }).userId;
        void persistChatMessage(m, userId);
      });
    }
  },
  setChatMessageStatus: (id, status) =>
    set((s) => ({
      chatMessages: s.chatMessages.map((message) =>
        message.id === id ? { ...message, status } : message,
      ),
    })),
  getOrCreateStreamingAgentMessage: () => {
    const last = get().chatMessages.at(-1);
    if (last?.role === "agent" && last.status === "streaming") return last;
    const message: ChatMessage = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "agent",
      text: "",
      ts: Date.now(),
      room: get().chatRoom,
      status: "streaming",
    };
    get().appendChatMessage(message);
    return message;
  },
  appendToLastAgentMessage: (chunk) => {
    const message = get().getOrCreateStreamingAgentMessage();
    set((s) => ({
      chatMessages: s.chatMessages.map((current) =>
        current.id === message.id
          ? { ...current, text: current.text + chunk, status: "streaming" }
          : current,
      ),
    }));
  },
  attachChatCard: (kind, payload) => {
    const message = get().getOrCreateStreamingAgentMessage();
    set((s) => ({
      chatMessages: s.chatMessages.map((current) => {
        if (current.id !== message.id) return current;
        const cards = current.cards ?? [];
        const existing = cards.find((card) => card.kind === kind);
        if (existing) {
          return {
            ...current,
            cards: cards.map((card) =>
              card.kind === kind
                ? {
                    ...card,
                    ...(payload ? { payload } : {}),
                  }
                : card,
            ),
          };
        }
        return {
          ...current,
          cards: [
            ...cards,
            {
              id: `${message.id}-${kind}`,
              kind,
              ...(payload ? { payload } : {}),
            },
          ],
        };
      }),
    }));
  },
  answerChatCard: (cardId, answer) =>
    set((s) => {
      let changed = false;
      const chatMessages = s.chatMessages.map((message) => {
        const cards = message.cards;
        if (!cards?.some((card) => card.id === cardId)) return message;
        return {
          ...message,
          cards: cards.map((card) => {
            if (card.id !== cardId) return card;
            changed = true;
            return {
              ...card,
              payload: { ...card.payload, answer },
            };
          }),
        };
      });
      return changed ? { chatMessages } : s;
    }),
  startChatToolTrace: (name, args) => {
    const message = get().getOrCreateStreamingAgentMessage();
    const trace: ToolTrace = {
      id: `${message.id}-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      ...(args ? { args } : {}),
      startedAt: Date.now(),
    };
    set((s) => ({
      chatMessages: s.chatMessages.map((current) =>
        current.id === message.id
          ? { ...current, tools: [...(current.tools ?? []), trace] }
          : current,
      ),
    }));
  },
  finishChatToolTrace: (name, ok) => {
    const message = [...get().chatMessages].reverse().find(
      (current) => current.role === "agent" && current.status === "streaming",
    );
    if (!message) return;
    const finishedAt = Date.now();
    set((s) => ({
      chatMessages: s.chatMessages.map((current) => {
        if (current.id !== message.id) return current;
        const traces = [...(current.tools ?? [])];
        let index = traces.length - 1;
        while (
          index >= 0 &&
          (traces[index].name !== name || traces[index].ok !== undefined)
        ) {
          index -= 1;
        }
        if (index >= 0) {
          traces[index] = {
            ...traces[index],
            ok,
            ms: Math.max(0, finishedAt - traces[index].startedAt),
          };
        } else {
          traces.push({
            id: `${message.id}-${name}-${finishedAt}`,
            name,
            ok,
            startedAt: finishedAt,
            ms: 0,
          });
        }
        return { ...current, tools: traces };
      }),
    }));
  },
  finalizeLastAgentMessage: (status = "done", usage) => {
    let finalised: ChatMessage | null = null;
    set((s) => {
      const list = s.chatMessages;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === "agent" && list[i].status === "streaming") {
          const next = list.slice();
          next[i] = usage ? { ...list[i], status, usage } : { ...list[i], status };
          finalised = next[i];
          return { chatMessages: next };
        }
      }
      return s;
    });
    if (finalised && (finalised as ChatMessage).text.trim()) {
      void import("./chat-persistence").then(({ persistChatMessage }) => {
        const userId = (get() as { userId: string }).userId;
        void persistChatMessage(finalised as ChatMessage, userId);
      });
    }
  },
  clearChatHistory: () => {
    if (get().chatCanvasOpen) get().closeChatCanvas();
    set({
      chatMessages: [],
      agentReply: "",
      chatRoom: "graph",
      room: "graph",
      chatCanvasOpen: false,
    });
  },

  /* --- canvas cards --- */
  windows: [],

  dispatchCanvas: (action) => {
    const current = get();
    const canvas: CanvasState = {
      windows: current.windows,
    };
    const next = applyCanvasAction(canvas, action);
    if (next === canvas) return;

    const top = topWindow(next.windows);
    set({
      windows: next.windows,
      ...(top ? { room: top.kind } : {}),
      ...(top ? { chatRoom: top.kind } : {}),
    });
  },

  openWindow: (kind, opts) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const payload = opts?.payload;
    get().dispatchCanvas({
      type: "open",
      kind,
      payload,
      openedBy: opts?.openedBy ?? (payload?.openedBy as "agent" | "user") ?? "user",
      at: opts?.at ?? now,
    });
    return get().windows.find((window) => window.kind === kind)?.id ?? `win-${kind}`;
  },

  closeWindow: (id) => get().dispatchCanvas({ type: "close", id }),
  bringToFront: (id) => get().dispatchCanvas({ type: "focus", id }),
  closeTopWindow: () => get().dispatchCanvas({ type: "close" }),

  room: "graph",
  setRoom: (room) => set({ room }),

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

  agentStatus: "",
  setAgentStatus: (agentStatus) => set({ agentStatus }),

  agentReply: "",
  lastQuery: "",
  startReply: (query) => set({ agentReply: "", lastQuery: query }),
  appendReply: (chunk) => set((s) => ({ agentReply: s.agentReply + chunk })),
  clearReply: () => set({ agentReply: "", lastQuery: "" }),
  roomStates: {},
  setRoomState: (room, state) =>
    set((s) => ({ roomStates: { ...s.roomStates, [room]: state } })),

}));
