import type { CanvasAction, CanvasState } from "./canvas-reducer";
import { applyCanvasAction, topWindow } from "./canvas-reducer";
import type { CanvasSnapshot, ToolCallRecord } from "./types";

const RING_CAP = 6;

function recordIntoRing(prev: ToolCallRecord[], rec: ToolCallRecord): ToolCallRecord[] {
  const next = [...prev, rec];
  return next.length > RING_CAP ? next.slice(next.length - RING_CAP) : next;
}

export function applyCanvasToSnapshot(
  snap: CanvasSnapshot,
  action: CanvasAction,
): CanvasSnapshot {
  const canvas: CanvasState = {
    windows: snap.windows.map((window) => ({
      id: window.id,
      kind: window.kind,
      mount: window.mount,
      rect: window.rect,
      zIndex: window.zIndex,
      pinned: window.pinned,
      openedAt: window.openedAt,
    })),
    mode: snap.ui?.mode ?? "windowed",
    viewport: snap.viewport,
  };
  const next = applyCanvasAction(canvas, action);
  const oldById = new Map(snap.windows.map((window) => [window.id, window]));
  const focused = topWindow(next.windows);
  return {
    ...snap,
    ui: { ...snap.ui, mode: next.mode },
    focusedId: focused?.id ?? null,
    windows: next.windows.map((window) => {
      const old = oldById.get(window.id);
      return {
        id: window.id,
        kind: window.kind,
        ...(old?.slug ? { slug: old.slug } : {}),
        mount: window.mount,
        rect: window.rect,
        zIndex: window.zIndex,
        focused: window.id === focused?.id,
        pinned: window.pinned,
        openedAt: window.openedAt,
        summary: old?.summary ?? window.kind,
      };
    }),
  };
}

export interface ToolApplyResult {
  snapshot: CanvasSnapshot;
  message: string;
  ok: boolean;
}

/** Record a tool call; canvas changes are applied exclusively from emitted events. */
export function applyToolToSnapshot(
  snap: CanvasSnapshot,
  tool: string,
  args: Record<string, unknown>,
  ok = true,
): ToolApplyResult {
  const record: ToolCallRecord = { t: 0, tool, args, ok };
  return {
    snapshot: {
      ...snap,
      recentActions: recordIntoRing(snap.recentActions, record),
    },
    message: ok ? `${tool} dispatched.` : `No window matched the ${tool} request.`,
    ok,
  };
}

/** Format a snapshot as the agent-facing user message. The agent sees
 *  this on the first turn; sub-agents see their delegated intent + the
 *  current snapshot at the top of every step. Keeps the model anchored
 *  on real state instead of hallucinating layout.
 *
 *  `opts.includeGrid` controls whether the 12×8 ASCII grid is included.
 *  Layout-agent needs it for spatial reasoning; content-agent does not. */
export function snapshotToPrompt(
  snap: CanvasSnapshot,
  opts: { includeGrid?: boolean; includeRecentActions?: boolean } = {},
): string {
  const includeGrid = opts.includeGrid ?? true;
  const includeRecentActions = opts.includeRecentActions ?? true;
  const lines: string[] = [];
  const mode = snap.ui?.mode ?? "windowed";
  const userId = snap.user?.userId ?? null;
  lines.push(
    `<canvas viewport=${snap.viewport.w}x${snap.viewport.h} mode=${mode} user_id=${userId ?? "NOT_SET"}>`,
  );

  if (snap.backend) {
    lines.push(
      `backend: surreal=${snap.backend.surrealOk ? "ok" : "DOWN"} composio=${snap.backend.composioOk ? "ok" : "DOWN"}`,
    );
  }
  if (snap.integrations && snap.integrations.length > 0) {
    const parts = snap.integrations.map((i) => `${i.slug}=${i.status}`);
    lines.push(`integrations: ${parts.join(" ")}`);
  }

  lines.push("");
  if (includeGrid) {
    lines.push("grid (12 cols × 8 rows, uppercase=focused, lowercase=open, ·=empty):");
    lines.push(snap.grid);
    lines.push("");
  }
  if (snap.windows.length === 0) {
    lines.push("windows: (none)");
  } else {
    lines.push("windows:");
    for (const w of snap.windows) {
      lines.push(
        `  - id=${w.id} kind=${w.kind}${w.slug ? ` slug=${w.slug}` : ""} mount=${w.mount} z=${w.zIndex} focused=${w.focused}` +
          (w.summary ? ` summary="${w.summary}"` : ""),
      );
    }
  }
  if (includeRecentActions && snap.recentActions.length > 0) {
    lines.push("");
    lines.push("recent actions (most recent last):");
    for (const a of snap.recentActions) {
      lines.push(
        `  - ${a.tool}(${JSON.stringify(a.args)}) → ${a.ok ? "ok" : "fail"}`,
      );
    }
  }
  lines.push("</canvas>");
  return lines.join("\n");
}
