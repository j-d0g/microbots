import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

export interface CanvasWindow {
  id: string;
  kind: WindowKind;
  openedAt: number;
  openedBy?: "agent" | "user";
  payload?: Record<string, unknown>;
}

export interface CanvasState {
  windows: CanvasWindow[];
}

export type CanvasAction =
  | { type: "open"; kind: WindowKind; payload?: Record<string, unknown>; openedBy?: "agent" | "user"; at?: number }
  | { type: "update_payload"; kind: WindowKind; payload: Record<string, unknown> }
  | { type: "close"; id?: string; kind?: WindowKind }
  | { type: "focus"; id?: string; kind?: WindowKind }
  | { type: "clear" };

export function windowIdForKind(kind: WindowKind): string {
  return `win-${kind}`;
}

export function topWindow(windows: readonly CanvasWindow[]): CanvasWindow | null {
  return windows.at(-1) ?? null;
}

export function findCanvasWindow(
  stateOrWindows: CanvasState | readonly CanvasWindow[],
  selector: { id?: string; kind?: WindowKind },
): CanvasWindow | null {
  const windows = Array.isArray(stateOrWindows)
    ? stateOrWindows
    : (stateOrWindows as CanvasState).windows;
  if (selector.id) {
    return windows.find((window) => window.id === selector.id) ?? null;
  }
  if (selector.kind) {
    return [...windows].reverse().find((window) => window.kind === selector.kind) ?? null;
  }
  return null;
}

function moveToEnd(
  windows: readonly CanvasWindow[],
  id: string,
  update: (window: CanvasWindow) => CanvasWindow = (window) => window,
): CanvasWindow[] {
  const target = windows.find((window) => window.id === id);
  if (!target) return [...windows];
  return [
    ...windows.filter((window) => window.id !== id),
    update(target),
  ];
}

export function applyCanvasAction(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "open": {
      const existing = findCanvasWindow(state, { kind: action.kind });
      if (existing) {
        return {
          ...state,
          windows: moveToEnd(state.windows, existing.id, (window) => ({
            ...window,
            ...(action.payload
              ? { payload: { ...window.payload, ...action.payload } }
              : {}),
            ...(action.openedBy ? { openedBy: action.openedBy } : {}),
            ...(action.at !== undefined ? { openedAt: action.at } : {}),
          })),
        };
      }
      return {
        ...state,
        windows: [
          ...state.windows,
          {
            id: windowIdForKind(action.kind),
            kind: action.kind,
            openedAt: action.at ?? 0,
            ...(action.openedBy ? { openedBy: action.openedBy } : {}),
            ...(action.payload ? { payload: action.payload } : {}),
          },
        ],
      };
    }
    case "update_payload": {
      const target = findCanvasWindow(state, { kind: action.kind });
      if (!target) return state;
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === target.id
            ? { ...window, payload: { ...window.payload, ...action.payload } }
            : window,
        ),
      };
    }
    case "close": {
      if (!action.id && !action.kind) {
        return state.windows.length === 0 ? state : { ...state, windows: [] };
      }
      const target = action.id || action.kind
        ? findCanvasWindow(state, { id: action.id, kind: action.kind })
        : topWindow(state.windows);
      if (!target) return state;
      return {
        ...state,
        windows: state.windows.filter((window) => window.id !== target.id),
      };
    }
    case "focus": {
      const target = findCanvasWindow(state, { id: action.id, kind: action.kind });
      if (!target) return state;
      return {
        ...state,
        windows: moveToEnd(state.windows, target.id),
      };
    }
    case "clear":
      return state.windows.length === 0 ? state : { ...state, windows: [] };
  }
}

export function canvasActionForEvent(evt: AgentEvent): CanvasAction | null {
  switch (evt.type) {
    case "ui.canvas":
      return evt.action;
    case "ui.tool.open":
      return { type: "open", kind: evt.kind, payload: evt.payload, openedBy: "agent" };
    case "ui.tool.update":
      return { type: "update_payload", kind: evt.kind, payload: evt.payload };
    case "ui.tool.done":
      return {
        type: "update_payload",
        kind: evt.kind,
        payload: { ...evt.payload, status: "done" },
      };
    case "ui.ask":
      return {
        type: "open",
        kind: "ask_user",
        payload: { question: evt.question, options: evt.options },
        openedBy: "agent",
      };
    default:
      return null;
  }
}
