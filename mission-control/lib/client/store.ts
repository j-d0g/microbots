"use client";

import { create } from "zustand";
import type { BusEvent, Snapshot, SpeakRequest } from "@/lib/types";
import { reduce } from "./reducer";

export const emptySnapshot: Snapshot = {
  agents: [],
  tasks: [],
  artifacts: [],
  feed: [],
  messages: [],
  focus: { items: [], recommendations: [], updatedAt: 0 },
  stage: { view: "stage", widgets: [] },
  demo: true,
  model: "demo",
  voice: { tts: false, stt: false },
};

interface LiveState {
  snapshot: Snapshot;
  thinking: Set<string>;
  speakQueue: SpeakRequest[];
  connected: boolean;
  setSnapshot: (snapshot: Snapshot) => void;
  applyEvent: (event: BusEvent) => void;
  setConnected: (connected: boolean) => void;
  shiftSpeak: () => SpeakRequest | undefined;
}

export const useMissionStore = create<LiveState>((set, get) => ({
  snapshot: emptySnapshot,
  thinking: new Set<string>(),
  speakQueue: [],
  connected: false,
  setSnapshot: (snapshot) => set({ snapshot }),
  setConnected: (connected) => set({ connected }),
  shiftSpeak: () => {
    const [first, ...remaining] = get().speakQueue;
    set({ speakQueue: remaining });
    return first;
  },
  applyEvent: (event) => set((state) => {
    if (event.type === "thinking") {
      const thinking = new Set(state.thinking);
      if (event.on) thinking.add(event.agentId);
      else thinking.delete(event.agentId);
      return { ...state, thinking };
    }
    if (event.type === "speak") {
      return { ...state, speakQueue: [...state.speakQueue, event.speak] };
    }
    return { ...state, snapshot: reduce(state.snapshot, event) };
  }),
}));
