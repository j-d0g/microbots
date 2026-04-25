/**
 * Per-window tool surfaces for the agent.
 *
 * Each room registers imperative tools via `registerTools()` in
 * `lib/room-tools.ts`. The browser's event router already dispatches
 * `ui.tool` events into that registry. This file mirrors those tools
 * as Zod-typed `tool()` definitions so the LLM has a structured way
 * to call them.
 *
 * All factories follow the same pattern:
 *   - `ensureOpen(kind)` emits a `ui.room` event if the window is not
 *     yet on the canvas, so the agent can compose "filter the brief"
 *     in a single step without first asking layout to open it.
 *   - The tool's `execute()` emits a `ui.tool` event the client will
 *     translate into `callRoomTool(room, tool, args)`.
 *
 * Naming convention: `<room>_<tool>` so the model sees a flat list
 * with obvious provenance and doesn't confuse e.g. `brief.filter`
 * with `workflow.filter`.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "./server-snapshot";
import type { AgentToolCtx } from "./tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { RoomKind } from "@/lib/store";
import type { CanvasSnapshot } from "./types";

/* ------------------------------------------------------------------ *
 *  shared helper
 * ------------------------------------------------------------------ */

function ensureRoomOpen(
  snap: CanvasSnapshot,
  kind: RoomKind,
): AgentEvent[] {
  return snap.windows.some((w) => w.kind === kind)
    ? []
    : [{ type: "ui.room", room: kind }];
}

/** Emit + simulate a single per-window tool call. The simulator
 *  already records the action into the ring buffer; we just need to
 *  make sure the local snapshot reflects the (possibly) implicit
 *  open. */
function dispatchRoomTool(
  ctx: AgentToolCtx,
  kind: RoomKind,
  tool: string,
  args: Record<string, unknown>,
): string {
  const fullName = `${kind}_${tool}`;
  ctx.emit({ type: "agent.tool.start", name: fullName, args });
  for (const e of ensureRoomOpen(ctx.snapshot, kind)) {
    ctx.emit(e);
    // Also keep the server-side snapshot in sync.
    ctx.snapshot = applyToolToSnapshot(ctx.snapshot, "open_window", {
      kind,
      mount: ctx.snapshot.windows.length === 0 ? "full" : "right-half",
    }).snapshot;
  }
  ctx.emit({ type: "ui.tool", room: kind, tool, args });
  ctx.snapshot = applyToolToSnapshot(ctx.snapshot, fullName, args).snapshot;
  ctx.emit({ type: "agent.tool.done", name: fullName, ok: true });
  return `${fullName} dispatched.`;
}

/* ------------------------------------------------------------------ *
 *  brief room
 * ------------------------------------------------------------------ */

export function briefTools(ctx: AgentToolCtx) {
  return {
    brief_filter: tool({
      description:
        "Filter the brief's automation proposals by tone (high/med/low) and/or integration slug. Pass null to clear that axis.",
      inputSchema: z.object({
        tone: z.enum(["all", "high", "med", "low"]).optional(),
        integration: z.string().nullable().optional(),
      }),
      execute: async (args) => dispatchRoomTool(ctx, "brief", "filter", args),
    }),
    brief_clear_filters: tool({
      description: "Reset every proposal filter on the brief.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "brief", "clear_filters", {}),
    }),
    brief_expand: tool({
      description: "Expand a proposal recipe in the brief by id (e.g. 'bp-001').",
      inputSchema: z.object({ id: z.string() }),
      execute: async (args) => dispatchRoomTool(ctx, "brief", "expand", args),
    }),
    brief_collapse: tool({
      description: "Collapse a previously expanded proposal recipe.",
      inputSchema: z.object({ id: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "brief", "collapse", args),
    }),
    brief_approve: tool({
      description:
        "Approve a proposal — queues a shadow deploy. Only use when the user explicitly says yes.",
      inputSchema: z.object({ id: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "brief", "approve", args),
    }),
    brief_defer: tool({
      description: "Defer a proposal until a later session.",
      inputSchema: z.object({ id: z.string() }),
      execute: async (args) => dispatchRoomTool(ctx, "brief", "defer", args),
    }),
    brief_scroll_to: tool({
      description:
        "Scroll the brief to a proposal id, or to a named section ('yesterday' | 'top').",
      inputSchema: z.object({
        id: z.string().optional(),
        section: z.enum(["yesterday", "top"]).optional(),
      }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "brief", "scroll_to", args),
    }),
    brief_highlight: tool({
      description: "Briefly flash a proposal so the user notices it.",
      inputSchema: z.object({ id: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "brief", "highlight", args),
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  workflow room
 * ------------------------------------------------------------------ */

export function workflowTools(ctx: AgentToolCtx) {
  return {
    workflow_filter: tool({
      description:
        "Filter the workflow list by integration slug (slack, github, linear, gmail, notion, perplexity). Pass null to clear.",
      inputSchema: z.object({ integration: z.string().nullable() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "workflow", "filter", args),
    }),
    workflow_clear_filters: tool({
      description: "Reset workflow filters.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "workflow", "clear_filters", {}),
    }),
    workflow_select: tool({
      description: "Open the workflow detail view by slug.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "workflow", "select", args),
    }),
    workflow_back: tool({
      description: "Return to the workflow list from a detail view.",
      inputSchema: z.object({}),
      execute: async () => dispatchRoomTool(ctx, "workflow", "back", {}),
    }),
    workflow_show_dag: tool({
      description: "Switch the active workflow detail to its DAG visualisation.",
      inputSchema: z.object({}),
      execute: async () => dispatchRoomTool(ctx, "workflow", "show_dag", {}),
    }),
    workflow_show_recipe: tool({
      description: "Switch the active workflow detail to its plain-english recipe.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "workflow", "show_recipe", {}),
    }),
    workflow_toggle_view: tool({
      description: "Toggle between recipe and DAG views.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "workflow", "toggle_view", {}),
    }),
    workflow_scroll_to: tool({
      description:
        "Scroll the workflow list to a slug and briefly highlight it. Detail-view no-op.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "workflow", "scroll_to", args),
    }),
    workflow_highlight: tool({
      description: "Briefly flash a workflow row to direct attention.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "workflow", "highlight", args),
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  stack room
 * ------------------------------------------------------------------ */

export function stackTools(ctx: AgentToolCtx) {
  return {
    stack_filter: tool({
      description: "Filter the stack panel by service health (all|ok|warn|down).",
      inputSchema: z.object({ health: z.enum(["all", "ok", "warn", "down"]) }),
      execute: async (args) => dispatchRoomTool(ctx, "stack", "filter", args),
    }),
    stack_clear_filters: tool({
      description: "Reset health filter.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "stack", "clear_filters", {}),
    }),
    stack_select: tool({
      description: "Open the service log drawer for a service slug (e.g. 'notion-scribe').",
      inputSchema: z.object({ slug: z.string() }),
      execute: async (args) => dispatchRoomTool(ctx, "stack", "select", args),
    }),
    stack_deselect: tool({
      description: "Close the service log drawer.",
      inputSchema: z.object({}),
      execute: async () => dispatchRoomTool(ctx, "stack", "deselect", {}),
    }),
    stack_scroll_to: tool({
      description: "Scroll to a service block by slug and briefly highlight it.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "stack", "scroll_to", args),
    }),
    stack_highlight: tool({
      description: "Briefly flash a service block.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "stack", "highlight", args),
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  waffle room (voice / dock state)
 * ------------------------------------------------------------------ */

export function waffleTools(ctx: AgentToolCtx) {
  return {
    waffle_set_state: tool({
      description:
        "Set the voice/dock state (idle|listening|thinking|speaking|hidden). Use sparingly — usually the dock is driven by upstream events.",
      inputSchema: z.object({
        state: z.enum(["idle", "listening", "thinking", "speaking", "hidden"]),
      }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "waffle", "set_state", args),
    }),
    waffle_set_transcript: tool({
      description:
        "Replace the live transcript with given text. Empty string clears.",
      inputSchema: z.object({ text: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "waffle", "set_transcript", args),
    }),
    waffle_append_transcript: tool({
      description: "Append a chunk to the transcript (streaming style).",
      inputSchema: z.object({ text: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "waffle", "append_transcript", args),
    }),
    waffle_clear_transcript: tool({
      description: "Clear the transcript.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "waffle", "clear_transcript", {}),
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  playbooks room
 * ------------------------------------------------------------------ */

export function playbooksTools(ctx: AgentToolCtx) {
  return {
    playbooks_filter: tool({
      description:
        "Filter playbooks by column (org|network|suggested|all) and/or integration slug.",
      inputSchema: z.object({
        column: z.enum(["org", "network", "suggested", "all"]).optional(),
        integration: z.string().optional(),
      }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "playbooks", "filter", args),
    }),
    playbooks_search: tool({
      description: "Substring search by title or one-liner. Empty clears.",
      inputSchema: z.object({ query: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "playbooks", "search", args),
    }),
    playbooks_clear_filters: tool({
      description: "Reset every playbook filter and search query.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "playbooks", "clear_filters", {}),
    }),
    playbooks_scroll_to: tool({
      description: "Scroll to a playbook by title and flash it.",
      inputSchema: z.object({ title: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "playbooks", "scroll_to", args),
    }),
    playbooks_highlight: tool({
      description: "Briefly flash a playbook by title to direct attention.",
      inputSchema: z.object({ title: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "playbooks", "highlight", args),
    }),
    playbooks_try_tonight: tool({
      description:
        "Stage a playbook for overnight shadow deploy (drops a confirmation toast).",
      inputSchema: z.object({ title: z.string() }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "playbooks", "try_tonight", args),
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  settings room
 * ------------------------------------------------------------------ */

export function settingsTools(ctx: AgentToolCtx) {
  return {
    settings_scroll_to: tool({
      description:
        "Scroll to a settings section: integrations|members|org|schedule|voice|memory|danger.",
      inputSchema: z.object({
        section: z.enum([
          "integrations",
          "members",
          "org",
          "schedule",
          "voice",
          "memory",
          "danger",
        ]),
      }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "settings", "scroll_to", args),
    }),
    settings_highlight: tool({
      description: "Briefly flash a settings section.",
      inputSchema: z.object({
        section: z.enum([
          "integrations",
          "members",
          "org",
          "schedule",
          "voice",
          "memory",
          "danger",
        ]),
      }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "settings", "highlight", args),
    }),
    settings_filter_integrations: tool({
      description:
        "Filter the integrations list by status (all|connected|disconnected).",
      inputSchema: z.object({
        integrations: z.enum(["all", "connected", "disconnected"]),
      }),
      execute: async (args) =>
        dispatchRoomTool(ctx, "settings", "filter", args),
    }),
    settings_clear_filters: tool({
      description: "Reset settings filters.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "settings", "clear_filters", {}),
    }),
    settings_wipe_graph: tool({
      description:
        "DESTRUCTIVE: stage a memory wipe (drops a confirmation toast). Only call when the user explicitly asks to wipe / reset / clear their memory. Never speculatively.",
      inputSchema: z.object({}),
      execute: async () =>
        dispatchRoomTool(ctx, "settings", "wipe_graph", {}),
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  selector — pick the union of bags whose room is on the canvas.
 *  Plus always-on graph tools (handled in tools.ts already).
 *
 *  PROGRESSIVE DISCLOSURE
 *  ----------------------
 *  Tool-context bloat is the silent latency killer. Today's layered
 *  design already keeps each LLM call's tool surface small:
 *
 *    LEVEL 0 | orchestrator       2 tools   (delegate_*, always)
 *    LEVEL 1 | layout-agent       6 tools   (only if delegated)
 *    LEVEL 1 | content-agent     ~14 baseline + ≤ 8 per relevant room
 *
 *  Inside the content-agent we compress further with an intent-aware
 *  filter: the agent only sees per-window tools for windows whose
 *  KIND is mentioned in the user's intent string (or, as a fallback,
 *  for every window currently open). All in ONE LLM call — no
 *  introspection round-trip. With 7 windows open and an intent of
 *  "approve the slack bug-triage proposal", the surface shrinks to
 *  generic + graph + brief = ~22 tools instead of 51.
 * ------------------------------------------------------------------ */

export function tooledRoomsFor(snap: CanvasSnapshot): RoomKind[] {
  return Array.from(new Set(snap.windows.map((w) => w.kind))).filter(
    (k): k is RoomKind => k !== "graph", // graph handled in tools.ts
  );
}

const FACTORY_BY_KIND: Partial<
  Record<RoomKind, (ctx: AgentToolCtx) => Record<string, ReturnType<typeof tool>>>
> = {
  brief: briefTools as never,
  workflow: workflowTools as never,
  stack: stackTools as never,
  waffle: waffleTools as never,
  playbooks: playbooksTools as never,
  settings: settingsTools as never,
};

/**
 * Keyword tags per room. We treat the intent string as a bag of
 * words; if any tag for a room matches (case-insensitive substring),
 * that room's tools join the active bag. Order doesn't matter — this
 * is OR across tags and across rooms.
 *
 * Tuning rules:
 *  - tags should be DISTINCTIVE — `select` is too generic to belong
 *    here; `proposal` and `playbook` are perfect.
 *  - prefer nouns and slugs that show up in the seed data (the model
 *    will say `bp-001`, `notion-scribe`, `bug-triage`, etc).
 *  - never include a tag that overlaps multiple rooms.
 */
const KIND_TAGS: Record<RoomKind, readonly string[]> = {
  brief: [
    "brief",
    "morning",
    "proposal",
    "automation",
    "approve",
    "defer",
    "queued",
    "bp-",
  ],
  graph: [
    "graph",
    "node",
    "ontology",
    "memory map",
    "neighbor",
    "shortest path",
    "subgraph",
  ],
  workflow: [
    "workflow",
    "recipe",
    "dag",
    "triage",
    "bug-triage",
    "wf-",
    "cadence",
  ],
  stack: [
    "stack",
    "service",
    "microservice",
    "log",
    "scribe",
    "distiller",
    "down",
    "warn",
    "health",
    "uptime",
  ],
  waffle: ["waffle", "voice", "transcript", "speak", "listen"],
  playbooks: [
    "playbook",
    "playbooks",
    "try tonight",
    "shadow deploy",
    "org playbook",
    "network playbook",
  ],
  settings: [
    "settings",
    "integration",
    "members",
    "danger",
    "wipe",
    "preferences",
    "schedule",
  ],
};

/**
 * Decide which rooms' tools to include based on the intent string and
 * the live snapshot.
 *
 * Strategy: UNION of (intent-matched kinds) ∪ (currently-open kinds).
 *
 * Why union (not intent-only): the user wants the agent to feel
 * present in the canvas — even when their query is about the stack,
 * a brief that's already open should still be reachable so the agent
 * can drop a memory card or highlight a related proposal as a side
 * effect. Limiting strictly to intent kinds robbed the agent of that
 * organic awareness.
 *
 * `graph` is always excluded here because `graphTools()` is included
 * unconditionally by the content-agent. Returning an empty list is
 * fine — the content-agent still has its baseline 16 tools.
 */
export function pickRelevantKinds(
  snap: CanvasSnapshot,
  intent?: string,
): RoomKind[] {
  const open = new Set(tooledRoomsFor(snap));
  const matched = new Set<RoomKind>();

  if (intent && intent.trim().length > 0) {
    const lower = intent.toLowerCase();
    for (const kind of Object.keys(KIND_TAGS) as RoomKind[]) {
      if (kind === "graph") continue; // handled by graphTools
      if (KIND_TAGS[kind].some((tag) => lower.includes(tag))) {
        matched.add(kind);
      }
    }
  }

  // Union, then drop graph defensively.
  const union = new Set<RoomKind>([...open, ...matched]);
  union.delete("graph");
  return [...union];
}

/** Compose a per-window tool bag, intent-narrowed by default. */
export function activeWindowTools(
  ctx: AgentToolCtx,
  intent?: string,
): Record<string, ReturnType<typeof tool>> {
  const bag: Record<string, ReturnType<typeof tool>> = {};
  for (const kind of pickRelevantKinds(ctx.snapshot, intent)) {
    const factory = FACTORY_BY_KIND[kind];
    if (!factory) continue;
    Object.assign(bag, factory(ctx));
  }
  return bag;
}
