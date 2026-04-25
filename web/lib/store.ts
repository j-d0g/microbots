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

  /* --- modal stack --- */
  modals: Modal[];
  openRoom: (kind: RoomKind, payload?: Record<string, unknown>) => void;
  closeModal: (id: string) => void;
  closeTopModal: () => void;
  promoteModal: (id: string) => void;
  updateModalPosition: (id: string, pos: { x: number; y: number } | Corner) => void;

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
