"use client";

import { create } from "zustand";

export type RoomName =
  | "brief"
  | "graph"
  | "workflow"
  | "stack"
  | "waffle"
  | "playbooks"
  | "settings";

export type DockState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "hidden";

export type CardKind = "memory" | "entity" | "source" | "diff" | "toast";

export interface AgentCard {
  id: string;
  kind: CardKind;
  data: Record<string, unknown>;
  /** milliseconds; undefined = sticky until dismissed */
  ttl?: number;
  createdAt: number;
}

export interface VerbPayload {
  verb: "highlight" | "explain" | "compare" | "draft" | "defer" | "confirm";
  args: Record<string, unknown>;
  at: number;
}

export interface AgentStoreState {
  room: RoomName;
  roomSlug: string | null;
  dock: DockState;
  cards: AgentCard[];
  transcript: string;
  lastVerb: VerbPayload | null;
  agentStatus: string;
  /** The streaming text reply to a typed query, rendered in the
   *  CommandBar overlay. Different from agentStatus, which is the
   *  short ambient hint the dock shows. */
  agentReply: string;
  /** Whether the typed-input CommandBar is open. */
  commandOpen: boolean;
  /** The currently submitted user query (for transcript display). */
  lastQuery: string;

  setRoom: (room: RoomName) => void;
  setRoomSlug: (slug: string | null) => void;
  setDock: (dock: DockState) => void;
  setAgentStatus: (status: string) => void;
  appendTranscript: (chunk: string) => void;
  clearTranscript: () => void;
  pushCard: (card: Omit<AgentCard, "createdAt">) => void;
  dismissCard: (id: string) => void;
  emitVerb: (verb: VerbPayload) => void;
  startReply: (query: string) => void;
  appendReply: (chunk: string) => void;
  clearReply: () => void;
  setCommandOpen: (open: boolean) => void;
}

const MAX_VISIBLE_CARDS = 3;

export const useAgentStore = create<AgentStoreState>((set) => ({
  room: "brief",
  roomSlug: null,
  dock: "idle",
  cards: [],
  transcript: "",
  lastVerb: null,
  agentStatus: "",
  agentReply: "",
  commandOpen: false,
  lastQuery: "",

  setRoom: (room) => set({ room }),
  setRoomSlug: (roomSlug) => set({ roomSlug }),
  setDock: (dock) => set({ dock }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  appendTranscript: (chunk) =>
    set((s) => ({ transcript: s.transcript + chunk })),
  clearTranscript: () => set({ transcript: "" }),
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
  emitVerb: (verb) => set({ lastVerb: verb }),
  startReply: (query) => set({ agentReply: "", lastQuery: query }),
  appendReply: (chunk) => set((s) => ({ agentReply: s.agentReply + chunk })),
  clearReply: () => set({ agentReply: "", lastQuery: "" }),
  setCommandOpen: (open) => set({ commandOpen: open }),
}));
