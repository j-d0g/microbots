import { useAgentStore, type AgentStoreState, type WindowState } from "@/lib/store";
import { WINDOW_REGISTRY } from "@/components/windows/registry";
import { topWindow } from "./canvas-reducer";
import type { CanvasSnapshot, WindowSnapshot } from "./types";

let CANVAS_T0 = typeof performance !== "undefined" ? performance.now() : Date.now();

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function snapshotWindow(
  win: WindowState,
  state: AgentStoreState,
  focusedId: string | null,
): WindowSnapshot {
  let summary = "";
  try {
    summary = WINDOW_REGISTRY[win.kind]?.summary(state, win) ?? "";
  } catch {
    summary = "";
  }
  return {
    id: win.id,
    kind: win.kind,
    ...(win.payload ? { payload: win.payload } : {}),
    focused: win.id === focusedId,
    openedAt: Math.max(0, Math.round(win.openedAt - CANVAS_T0)),
    summary,
  };
}

export function buildSnapshot(opts?: { query?: string }): CanvasSnapshot {
  const state = useAgentStore.getState();
  const focusedId = topWindow(state.windows)?.id ?? null;
  const windows = state.windows.map((window) =>
    snapshotWindow(window, state, focusedId),
  );

  return {
    focusedId,
    windows,
    user: {
      query: opts?.query ?? "",
      lastQuery: state.lastQuery || undefined,
      userId: state.userId ?? null,
    },
    integrations: state.connections.map((connection) => ({
      slug: connection.slug,
      status: connection.status,
    })),
    backend: state.backendHealth
      ? {
          surrealOk: state.backendHealth.surrealOk,
          composioOk: state.backendHealth.composioOk,
          composioConfigured: state.backendHealth.composioConfigured,
        }
      : undefined,
  };
}

export function estimateTokens(snapshot: CanvasSnapshot): number {
  return Math.ceil(JSON.stringify(snapshot).length / 4);
}
