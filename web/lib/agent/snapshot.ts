import { useAgentStore } from "@/lib/store";
import type { CanvasSnapshot } from "./types";

export function buildSnapshot(): CanvasSnapshot {
  const state = useAgentStore.getState();
  const current = state.windows.at(-1);
  const recentCards = state.chatMessages
    .flatMap((message) => message.cards ?? [])
    .map((card) => ({
      kind: card.kind,
      ...(typeof card.payload?.focus === "string"
        ? { focus: card.payload.focus }
        : {}),
    }))
    .slice(-5);
  return {
    open: current
      ? {
          kind: current.kind,
          ...(typeof current.payload?.focus === "string"
            ? { focus: current.payload.focus }
            : {}),
        }
      : null,
    recentCards,
  };
}

export function estimateTokens(snapshot: CanvasSnapshot): number {
  return Math.ceil(JSON.stringify(snapshot).length / 4);
}
