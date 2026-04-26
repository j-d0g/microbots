/**
 * Canonical wire-shape between the canvas and any agent (orchestrator,
 * layout sub-agent, content sub-agent, offline scripted router).
 *
 * Everything here is JSON-serialisable. No DOM refs, no React types,
 * no functions. The agent reads this; the agent never reads pixels.
 *
 * See `microbots_text_canvas_representation` plan, §2.
 */

import type { RoomKind } from "../store";

/** Twelve named anchors + two PiP corners. The layout-agent picks
 *  one per window; the layout-engine resolves it to a viewport rect. */
export type MountPoint =
  | "full"
  | "left-half"
  | "right-half"
  | "right-wide"
  | "top-half"
  | "bottom-half"
  | "left-third"
  | "center-third"
  | "right-third"
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | "pip-br"
  | "pip-tr"
  /** The window's rect doesn't match any named anchor closely enough. */
  | "freeform";

/** A rectangle in PERCENT of the canvas (0..100). The renderer maps
 *  these to pixels at draw time; the agent reasons in % so it's
 *  viewport-independent. */
export interface RectPct {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Per-window snapshot the agent receives. Everything is plain JSON.
 *  `summary` is the single line provided by the WindowModule for that
 *  kind; ≤ 80 chars, present-tense, factual.
 *
 *  `title` is intentionally omitted from the wire shape — it's
 *  derivable from `kind` via the WINDOW_REGISTRY the agent already
 *  has, and dropping it keeps the 4-window snapshot inside the 350
 *  token budget. */
export interface WindowSnapshot {
  id: string;
  kind: RoomKind;
  /** For per-instance kinds (e.g. integration windows keyed by slug). */
  slug?: string;
  mount: MountPoint;
  rect: RectPct;
  zIndex: number;
  focused: boolean;
  /** ms since the canvas mounted (relative time so payloads compress). */
  openedAt: number;
  summary: string;
}

/** A record of a tool call the agent recently issued. Drives the
 *  ring-buffer history that prevents the model from re-issuing
 *  no-ops or re-opening already-open windows. */
export interface ToolCallRecord {
  /** ms ago, computed at snapshot time so the model sees relative
   *  freshness without absolute timestamps. */
  t: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

/** Full canvas snapshot. Pass this to the agent as a JSON object;
 *  `grid` is a 12×8 ASCII map for spatial reasoning. */
export interface CanvasSnapshot {
  /** Pixel viewport size — useful for the agent to know "the user is
   *  on a small laptop" vs "a big monitor". */
  viewport: { w: number; h: number };
  /** A 12×8 ASCII map. Each cell is 2 chars (letter + space), each
   *  row separated by `\n`. Uppercase = focused, lowercase = unfocused,
   *  `·` = empty. Letters assigned in z-order (A = lowest z). */
  grid: string;
  focusedId: string | null;
  windows: WindowSnapshot[];
  recentActions: ToolCallRecord[];
  user: { query: string; lastQuery?: string; userId?: string | null };
  /** Active UI mode. Tools and prompts gate behaviour off this. In
   *  `windowed` only `graph | settings | integration` may be opened;
   *  in `chat` the legacy seven kinds are reachable. */
  ui?: { mode: "windowed" | "chat" };
  /** Live composio connection status mirror — agent can check whether
   *  a toolkit is connected without burning a tool call. */
  integrations?: { slug: string; status: string }[];
  /** Most recent /api/health probe — agent can mention degraded
   *  mode in its reply rather than failing silently. */
  backend?: { surrealOk: boolean; composioOk: boolean };
}

/** Result returned by every layout-tool's `execute()` so the next
 *  step in the agent loop sees a fresh, post-mutation snapshot. */
export interface ToolResult {
  ok: boolean;
  message?: string;
  snapshot: CanvasSnapshot;
}
