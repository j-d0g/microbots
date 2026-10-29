import type { CanvasAction } from "./canvas-reducer";
import type { CanvasSnapshot, CardRef } from "./types";

export function applyCanvasToSnapshot(
  snapshot: CanvasSnapshot,
  action: CanvasAction,
): CanvasSnapshot {
  if (action.type === "open") {
    const card: CardRef = {
      kind: action.kind,
      ...(typeof action.payload?.focus === "string"
        ? { focus: action.payload.focus }
        : {}),
    };
    return {
      open: card,
      recentCards: [...snapshot.recentCards, card].slice(-5),
    };
  }
  if (action.type === "close") {
    if (action.kind && snapshot.open?.kind !== action.kind) return snapshot;
    return { ...snapshot, open: null };
  }
  if (action.type === "clear") return { ...snapshot, open: null };
  if (action.type === "update_payload" && snapshot.open?.kind === action.kind) {
    return {
      ...snapshot,
      open: {
        kind: action.kind,
        ...(typeof action.payload.focus === "string"
          ? { focus: action.payload.focus }
          : snapshot.open.focus
            ? { focus: snapshot.open.focus }
            : {}),
      },
    };
  }
  return snapshot;
}

export function snapshotToPrompt(snapshot: CanvasSnapshot): string {
  const formatCard = (card: CanvasSnapshot["open"]) =>
    card ? `${card.kind}${card.focus ? ` (${card.focus})` : ""}` : "none";
  const recent = snapshot.recentCards
    .map((card) => formatCard(card))
    .join(", ") || "none";
  return `<canvas>\nopen: ${formatCard(snapshot.open)}\nrecent cards: ${recent}\n</canvas>`;
}
