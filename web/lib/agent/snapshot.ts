/**
 * Snapshot builder. Three responsibilities:
 *
 *   1. `buildSnapshot()` — assemble a `CanvasSnapshot` from the live
 *      Zustand store + viewport, summaries, and an ASCII grid.
 *   2. `renderGrid()` — produce the 12×8 ASCII map from visible windows.
 *   3. `recordAction()` — push a `ToolCallRecord` into the store's
 *      ring buffer (cap 6).
 *
 * The agent NEVER receives pixels. It receives the JSON output of
 * `buildSnapshot()`.
 */

import { useAgentStore, type AgentStoreState, type WindowState } from "@/lib/store";
import { WINDOW_REGISTRY } from "@/components/stage/window-registry";
import { topWindow } from "./canvas-reducer";
import type {
  CanvasSnapshot,
  MountPoint,
  ToolCallRecord,
  WindowSnapshot,
} from "./types";

export const GRID_COLS = 12;
export const GRID_ROWS = 8;
const RING_CAP = 6;

/** Used to compute `openedAt` as ms-since-canvas-mount instead of
 *  absolute Unix time, so the snapshot stays compact and the agent's
 *  notion of "recent" is anchored to the session, not the wall clock. */
let CANVAS_T0 = typeof performance !== "undefined" ? performance.now() : Date.now();

/** Reset the relative-time origin. Called when the canvas is cleared
 *  (e.g. user closes everything and starts fresh). */
export function resetCanvasClock() {
  CANVAS_T0 = typeof performance !== "undefined" ? performance.now() : Date.now();
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Snapshot a single window. */
function snapshotWindow(
  win: WindowState,
  state: AgentStoreState,
  focusedId: string | null,
): WindowSnapshot {
  const mod = WINDOW_REGISTRY[win.kind];
  let summary = "";
  try {
    // Pass the live window so per-instance summaries (e.g. integration
    // windows keyed by payload.slug) can specialise.
    summary = mod?.summary(state, win) ?? "";
  } catch {
    // a buggy summary should never crash the agent loop
    summary = "";
  }
  return {
    id: win.id,
    kind: win.kind,
    slug: undefined,
    mount: win.mount,
    rect: win.rect,
    zIndex: win.zIndex,
    focused: win.id === focusedId,
    pinned: win.pinned,
    openedAt: 0, // populated by the caller using its own clock
    summary,
  };
}

/** Build the full snapshot from the store and current viewport. */
export function buildSnapshot(opts?: {
  query?: string;
  viewport?: { w: number; h: number };
}): CanvasSnapshot {
  const state = useAgentStore.getState();
  const viewport =
    opts?.viewport ??
    (typeof window !== "undefined"
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 1440, h: 900 });

  const focusedId = topWindow(state.windows)?.id ?? null;

  const t0 = state.canvasT0 ?? CANVAS_T0;
  const windows: WindowSnapshot[] = state.windows.map((w) => {
    const snap = snapshotWindow(w, state, focusedId);
    snap.openedAt = Math.round(((w.openedAt ?? nowMs()) - t0));
    return snap;
  });

  const grid = renderGrid(windows);

  const recentActions = (state.recentActions ?? []).map((a) => ({
    ...a,
    t: Math.max(0, Math.round(nowMs() - a.t)),
  }));

  return {
    viewport,
    grid,
    focusedId,
    windows,
    recentActions,
    user: {
      query: opts?.query ?? "",
      lastQuery: state.lastQuery || undefined,
      userId: state.userId ?? null,
    },
    ui: { mode: state.uiMode ?? "windowed" },
    integrations: state.connections.map((c) => ({
      slug: c.slug,
      status: c.status,
    })),
    backend: state.backendHealth
      ? {
          surrealOk: state.backendHealth.surrealOk,
          composioOk: state.backendHealth.composioOk,
        }
      : undefined,
  };
}

/** Render a 12×8 ASCII map. Letters are A, B, C… in z-order (lowest
 *  first). Focused window is uppercase, others lowercase. Empty cells
 *  use the middle-dot. Cells are space-separated for readability. */
export function renderGrid(windows: WindowSnapshot[]): string {
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () =>
    Array<string>(GRID_COLS).fill("·"),
  );

  // Lowest z first → drawn first → higher z paints over.
  const ordered = [...windows].sort((a, b) => a.zIndex - b.zIndex);
  ordered.forEach((win, i) => {
    if (i >= 26) return; // we only have 26 letters; clamp.
    const letter = String.fromCharCode(65 + i); // A..Z
    const ch = win.focused ? letter : letter.toLowerCase();
    const x0 = Math.max(0, Math.floor((win.rect.x / 100) * GRID_COLS));
    const y0 = Math.max(0, Math.floor((win.rect.y / 100) * GRID_ROWS));
    const x1 = Math.min(
      GRID_COLS,
      Math.ceil(((win.rect.x + win.rect.w) / 100) * GRID_COLS),
    );
    const y1 = Math.min(
      GRID_ROWS,
      Math.ceil(((win.rect.y + win.rect.h) / 100) * GRID_ROWS),
    );
    for (let r = y0; r < y1; r++) {
      for (let c = x0; c < x1; c++) {
        grid[r][c] = ch;
      }
    }
  });

  return grid.map((row) => row.join(" ")).join("\n");
}

/** Push a tool-call into the ring buffer. Capped at the most recent
 *  6 entries so the agent's history never grows unbounded. */
export function recordAction(record: Omit<ToolCallRecord, "t"> & { t?: number }): void {
  const t = record.t ?? nowMs();
  const next: ToolCallRecord = {
    t,
    tool: record.tool,
    args: record.args,
    ok: record.ok,
  };
  useAgentStore.getState().pushAction(next, RING_CAP);
}

/** Estimate how many tokens the snapshot will consume for the agent.
 *  Heuristic: ~4 chars per token. Useful for compact status summaries.
 *  budget readout. Not exact — Gemini's tokenizer differs. */
export function estimateTokens(snapshot: CanvasSnapshot): number {
  const json = JSON.stringify({
    viewport: snapshot.viewport,
    focusedId: snapshot.focusedId,
    windows: snapshot.windows,
    recentActions: snapshot.recentActions,
    user: snapshot.user,
  });
  // ASCII grid is mostly 1-char tokens, so undercount.
  const chars = json.length + snapshot.grid.length;
  return Math.ceil(chars / 4);
}

/** Available mount points. Re-exported here so callers don't have to
 *  reach into mount-points directly. */
export type { MountPoint };
