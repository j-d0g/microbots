"use client";
// Adapter over the live store, so components depend on one small surface.
import { useMemo } from "react";
import type { Agent, Snapshot } from "@/lib/types";
import { useMissionStore as useMC } from "./store";
import { useLiveState } from "./use-live-state";

export { useMC, useLiveState };

export function useSnapshot(): Snapshot {
  return useMC((s) => s.snapshot);
}

export function useAgentMap(): Record<string, Agent> {
  const agents = useMC((s) => s.snapshot.agents);
  return useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
}

export function useIsThinking(agentId: string): boolean {
  return useMC((s) => s.thinking.has(agentId));
}

export const useConnected = () => useMC((s) => s.connected);
