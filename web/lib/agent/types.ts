import type { RoomKind } from "../store";

export interface WindowSnapshot {
  id: string;
  kind: RoomKind;
  slug?: string;
  payload?: Record<string, unknown>;
  focused: boolean;
  openedAt: number;
  summary: string;
}

export interface CanvasSnapshot {
  focusedId: string | null;
  windows: WindowSnapshot[];
  user: { query: string; lastQuery?: string; userId?: string | null };
  integrations?: { slug: string; status: string }[];
  backend?: {
    surrealOk: boolean;
    composioOk: boolean;
    composioConfigured?: boolean;
  };
}

export interface ToolResult {
  ok: boolean;
  message?: string;
  snapshot: CanvasSnapshot;
}
