"use client";
import { create } from "zustand";
import type { SpeakRequest, View } from "@/lib/types";

export type Attention = "normal" | "focus" | "mute";
export type VoiceState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

interface UIState {
  attention: Attention;
  voiceState: VoiceState;
  interim: string; // live transcript while listening
  view: View;
  selectedAgentId: string | null;
  openTaskId: string | null;
  held: SpeakRequest[]; // focus-mode expansions waiting for "brief me"
  speakingAgentId: string | null;
  set: (p: Partial<Omit<UIState, "set">>) => void;
}

export const useUI = create<UIState>((set) => ({
  attention: "normal",
  voiceState: "idle",
  interim: "",
  view: "stage",
  selectedAgentId: null,
  openTaskId: null,
  held: [],
  speakingAgentId: null,
  set: (p) => set(p),
}));

// Audio level lives outside React so the orb can read it every frame without re-rendering.
export const audioLevel = { current: 0 };
