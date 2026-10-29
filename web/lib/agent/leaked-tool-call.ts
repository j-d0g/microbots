/**
 * Recovery for leaked tool-call syntax in streamed model text.
 *
 * Gemini-2.5-flash-lite (our policy-locked production model — see
 * the tool-call protocol intermittently emits a tool call as
 * plain text instead of using the structured tool-call channel. When
 * that happens, the stream looks like:
 *
 *   reply.chunk: "open_window(kind='graph')\nmorning. I’ll show the graph."
 *
 * …and the canvas never moves. This module is the safety net: scan
 * the accumulated reply for known tool-call patterns, parse the args,
 * and dispatch the same UI events the real tool would have emitted.
 *
 * Scope is intentionally narrow:
 *   - Only navigation tools with direct canvas side effects
 *     (open_window, close_window, focus_window). These
 *     are by far the most common leakages we have seen in dev logs.
 *   - We never invent KG writes from text — those need user intent
 *     to flow through the typed schema, not regex.
 */

import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

const KNOWN_KINDS: ReadonlySet<WindowKind> = new Set<WindowKind>([
  "graph",
  "ask_user",
  "integrations",
  "integration_detail",
  "entities",
  "entity_detail",
  "memories",
  "skills",
  "workflows",
  "composio_connect",
]);

/* Match both quote styles and optional focused-card arguments. */
const OPEN_WINDOW_RE =
  /\bopen_window\s*\(\s*kind\s*=\s*['"]([a-z_]+)['"](?:\s*,\s*focus\s*=\s*['"]([^'"]+)['"])?[^)]*\)/i;

const CLOSE_WINDOW_RE =
  /\bclose_window\s*\(\s*kind\s*=\s*['"]([a-z_]+)['"](?:[^)]*)\)/i;

const FOCUS_WINDOW_RE =
  /\bfocus_window\s*\(\s*kind\s*=\s*['"]([a-z_]+)['"](?:[^)]*)\)/i;

export interface LeakedToolCall {
  /** Synthetic tool-call name (matches the real tool name). */
  name: "open_window" | "close_window" | "focus_window";
  /** Args extracted from the leaked syntax. */
  args: { kind: WindowKind; focus?: string };
  /** UI events to emit so the canvas mutates as if the tool fired. */
  events: AgentEvent[];
  /** Tool-call+done markers so the sidecar log mirrors a real call. */
  marker: { start: AgentEvent; done: AgentEvent };
}

function asKind(raw: string): WindowKind | null {
  return KNOWN_KINDS.has(raw as WindowKind) ? (raw as WindowKind) : null;
}

/** Scan `text` for the first leaked canvas navigation call. Returns
 *  null when nothing was leaked or the kind is unknown. */
export function detectLeakedToolCall(text: string): LeakedToolCall | null {
  const open = text.match(OPEN_WINDOW_RE);
  if (open) {
    const kind = asKind(open[1]);
    if (kind) {
      const focus = open[2];
      const args = focus ? { kind, focus } : { kind };
      return {
        name: "open_window",
        args,
        events: [{
          type: "ui.canvas",
          action: {
            type: "open",
            kind,
            ...(focus ? { payload: { focus } } : {}),
            openedBy: "agent",
          },
        }],
        marker: {
          start: {
            type: "agent.tool.start",
            name: "open_window",
            args: { ...args, recovered: true },
          },
          done: { type: "agent.tool.done", name: "open_window", ok: true },
        },
      };
    }
  }
  const close = text.match(CLOSE_WINDOW_RE);
  if (close) {
    const kind = asKind(close[1]);
    if (kind) {
      return {
        name: "close_window",
        args: { kind },
        events: [{ type: "ui.canvas", action: { type: "close", kind } }],
        marker: {
          start: {
            type: "agent.tool.start",
            name: "close_window",
            args: { kind, recovered: true },
          },
          done: { type: "agent.tool.done", name: "close_window", ok: true },
        },
      };
    }
  }
  const focus = text.match(FOCUS_WINDOW_RE);
  if (focus) {
    const kind = asKind(focus[1]);
    if (kind) {
      return {
        name: "focus_window",
        args: { kind },
        events: [{ type: "ui.canvas", action: { type: "focus", kind } }],
        marker: {
          start: {
            type: "agent.tool.start",
            name: "focus_window",
            args: { kind, recovered: true },
          },
          done: { type: "agent.tool.done", name: "focus_window", ok: true },
        },
      };
    }
  }
  return null;
}
