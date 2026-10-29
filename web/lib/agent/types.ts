import type { WindowKind } from "../store";

export interface CardRef {
  kind: WindowKind;
  focus?: string;
}

export interface CanvasSnapshot {
  open: CardRef | null;
  recentCards: CardRef[];
}
