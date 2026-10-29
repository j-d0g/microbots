import type { CanvasAction, CanvasState } from "./canvas-reducer";
import { applyCanvasAction, topWindow } from "./canvas-reducer";
import type { CanvasSnapshot } from "./types";

export function applyCanvasToSnapshot(
  snapshot: CanvasSnapshot,
  action: CanvasAction,
): CanvasSnapshot {
  const state: CanvasState = {
    windows: snapshot.windows.map((window) => ({
      id: window.id,
      kind: window.kind,
      ...(window.payload ? { payload: window.payload } : {}),
      openedAt: window.openedAt,
    })),
  };
  const next = applyCanvasAction(state, action);
  const oldById = new Map(snapshot.windows.map((window) => [window.id, window]));
  const focused = topWindow(next.windows);

  return {
    ...snapshot,
    focusedId: focused?.id ?? null,
    windows: next.windows.map((window) => {
      const previous = oldById.get(window.id);
      return {
        id: window.id,
        kind: window.kind,
        ...(previous?.slug ? { slug: previous.slug } : {}),
        ...(window.payload ? { payload: window.payload } : {}),
        focused: window.id === focused?.id,
        openedAt: window.openedAt,
        summary: previous?.summary ?? window.kind,
      };
    }),
  };
}

export function snapshotToPrompt(snapshot: CanvasSnapshot): string {
  const userId = snapshot.user.userId ?? null;
  const lines = [
    `<canvas user_id=${userId ?? "NOT_SET"}>`,
  ];

  if (snapshot.backend) {
    lines.push(
      `backend: surreal=${snapshot.backend.surrealOk ? "ok" : "DOWN"} composio=${
        snapshot.backend.composioOk
          ? "ok"
          : snapshot.backend.composioConfigured === false
            ? "not-configured"
            : "DOWN"
      }`,
    );
  }
  if (snapshot.integrations?.length) {
    lines.push(
      `integrations: ${snapshot.integrations
        .map((integration) => `${integration.slug}=${integration.status}`)
        .join(" ")}`,
    );
  }

  lines.push("");
  if (snapshot.windows.length === 0) {
    lines.push("open cards: (none)");
  } else {
    lines.push("open cards, most recently opened last:");
    for (const window of snapshot.windows) {
      lines.push(
        `  - id=${window.id} kind=${window.kind}${window.slug ? ` slug=${window.slug}` : ""} focused=${window.focused}` +
          (window.summary ? ` summary="${window.summary}"` : ""),
      );
    }
  }
  lines.push("</canvas>");
  return lines.join("\n");
}

export function toolResult(
  name: string,
  _args: Record<string, unknown>,
  ok = true,
): { ok: boolean; message: string } {
  return {
    ok,
    message: `${name} ${ok ? "completed." : "failed."}`,
  };
}
