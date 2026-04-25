"use client";

/**
 * Room Tools registry.
 *
 * Each room mounts a set of imperative tools that an agent (or test
 * harness) can invoke to drive the UI: scroll to a specific item,
 * toggle a filter, select something, expand/collapse a panel.
 *
 * The shape is intentionally tiny and uniform so that the agent layer
 * (or a remote MCP-style transport) can address any room with the
 * same envelope: { room, tool, args }.
 *
 * Discovery: every tool ships a description so the agent can introspect
 * what's available (`window.__roomTools.brief.list()`).
 */

import type { RoomKind } from "./store";

export interface ToolDef {
  name: string;
  description: string;
  args?: Record<string, string>;
  /** Imperative handler. Should be idempotent and forgiving. */
  run: (args: Record<string, unknown>) => void | Promise<void>;
}

export interface RoomToolset {
  list: () => Array<{ name: string; description: string; args?: Record<string, string> }>;
  call: (tool: string, args?: Record<string, unknown>) => Promise<unknown>;
}

type Registry = Partial<Record<RoomKind, Map<string, ToolDef>>>;

const registry: Registry = {};

/** Browser global so the agent layer / Playwright / MCP bridge can poke at tools. */
declare global {
  interface Window {
    __roomTools?: Partial<Record<RoomKind, RoomToolset>>;
    __roomToolsAll?: () => Array<{ room: RoomKind; tools: Array<{ name: string; description: string; args?: Record<string, string> }> }>;
  }
}

function exposeGlobal() {
  if (typeof window === "undefined") return;
  const out: Partial<Record<RoomKind, RoomToolset>> = {};
  (Object.keys(registry) as RoomKind[]).forEach((room) => {
    const map = registry[room];
    if (!map) return;
    out[room] = makeToolset(room);
  });
  window.__roomTools = out;
  window.__roomToolsAll = () => {
    const rooms = Object.keys(registry) as RoomKind[];
    return rooms.map((room) => ({
      room,
      tools: Array.from(registry[room]!.values()).map((t) => ({
        name: t.name,
        description: t.description,
        args: t.args,
      })),
    }));
  };
}

function makeToolset(room: RoomKind): RoomToolset {
  return {
    list() {
      const map = registry[room];
      if (!map) return [];
      return Array.from(map.values()).map((t) => ({
        name: t.name,
        description: t.description,
        args: t.args,
      }));
    },
    async call(tool, args = {}) {
      const map = registry[room];
      const def = map?.get(tool);
      if (!def) {
        // eslint-disable-next-line no-console
        console.warn(`[room-tools] no tool '${tool}' on room '${room}'`);
        return undefined;
      }
      return def.run(args);
    },
  };
}

/** Register a tool for a room. Returns an unregister fn. */
export function registerTool(room: RoomKind, tool: ToolDef): () => void {
  const map = registry[room] ?? (registry[room] = new Map());
  map.set(tool.name, tool);
  exposeGlobal();
  return () => {
    map.delete(tool.name);
    if (map.size === 0) delete registry[room];
    exposeGlobal();
  };
}

/** Register many tools at once. Returns an unregister-all fn. */
export function registerTools(room: RoomKind, tools: ToolDef[]): () => void {
  const offs = tools.map((t) => registerTool(room, t));
  return () => offs.forEach((off) => off());
}

/** Imperative call (used by the agent event router). */
export async function callRoomTool(
  room: RoomKind,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const map = registry[room];
  const def = map?.get(tool);
  if (!def) {
    // eslint-disable-next-line no-console
    console.warn(`[room-tools] no tool '${tool}' on room '${room}'`);
    return undefined;
  }
  return def.run(args);
}

/** Read-only snapshot of the registry, for debugging / tests. */
export function listRoomTools(): Array<{ room: RoomKind; tools: ToolDef[] }> {
  return (Object.keys(registry) as RoomKind[]).map((room) => ({
    room,
    tools: Array.from(registry[room]!.values()),
  }));
}
