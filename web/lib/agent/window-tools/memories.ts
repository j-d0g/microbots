/**
 * Memories window tools — per-window tool surface for the memories list.
 *
 * These tools allow the UI agent to interact with the memories window:
 * - Sort and filter the memory list
 * - Search memories by content
 * - Control display settings (limit)
 * - Quick-add new memories
 * - Read related entity/integration info
 * - Refresh and export memories
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import { getKgMemories, addMemory } from "@/lib/api/backend";
import type { Memory } from "@/lib/api/backend";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

/* ------------------------------------------------------------------ *
 *  Helper
 * ------------------------------------------------------------------ */

/** Helper that emits the tool-start chip, the underlying UI events,
 *  mutates the server-side snapshot mirror, and emits tool-done. */
function applyAndEmit(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
  uiEvents: AgentEvent[],
): string {
  ctx.emit({ type: "agent.tool.start", name: toolName, args });
  for (const e of uiEvents) ctx.emit(e);
  const result = applyToolToSnapshot(ctx.snapshot, toolName, args);
  ctx.snapshot = result.snapshot;
  ctx.emit({ type: "agent.tool.done", name: toolName, ok: (result.ok ?? true) });
  return result.message;
}

/** Ensure the memories window is open; returns events to open it if needed. */
function ensureMemoriesWindow(ctx: AgentToolCtx): AgentEvent[] {
  return ctx.snapshot.windows.some((w) => w.kind === "memories")
    ? []
    : [{ type: "ui.room", room: "memories" as WindowKind }];
}

/** Dispatch a tool command to the memories window. */
function dispatchToMemories(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const events: AgentEvent[] = [
    ...ensureMemoriesWindow(ctx),
    { type: "ui.tool", room: "memories" as WindowKind, tool: toolName, args },
  ];
  return applyAndEmit(ctx, `memories_${toolName}`, args, events);
}

/* ------------------------------------------------------------------ *
 *  Zod schemas
 * ------------------------------------------------------------------ */

const MEMORY_TYPE = z.enum([
  "fact",
  "observation",
  "preference",
  "skill",
  "goal",
  "habit",
  "insight",
]);

const SORT_BY = z.enum(["confidence", "recency"]);

/* ------------------------------------------------------------------ *
 *  Memories window tools
 * ------------------------------------------------------------------ */

export function memoriesWindowTools(ctx: AgentToolCtx) {
  return {
    /** 1. List memories with current sort/filter */
    memories_list: tool({
      description:
        "List memories in the memories window with the current sort and filter settings. Returns the count and current view configuration.",
      inputSchema: z.object({}),
      execute: async () => {
        let memories: Memory[] = [];
        try {
          memories = await getKgMemories();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "memories_list", args: {} });
          ctx.emit({ type: "agent.tool.done", name: "memories_list", ok: false });
          return `Failed to list memories: ${msg}`;
        }
        const events: AgentEvent[] = [
          ...ensureMemoriesWindow(ctx),
          {
            type: "ui.tool",
            room: "memories" as WindowKind,
            tool: "list",
            args: { data: memories },
          },
        ];
        return applyAndEmit(ctx, "memories_list", {}, events);
      },
    }),

    /** 2. Sort by confidence (highest first) */
    memories_sort_by_confidence: tool({
      description:
        "Sort the memories list by confidence level, showing highest confidence memories first.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatchToMemories(ctx, "sort_by_confidence", { by: "confidence" });
      },
    }),

    /** 3. Sort by recency (newest first) */
    memories_sort_by_recency: tool({
      description:
        "Sort the memories list by recency, showing the most recently updated memories first.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatchToMemories(ctx, "sort_by_recency", { by: "recency" });
      },
    }),

    /** 4. Change the number of memories displayed */
    memories_set_limit: tool({
      description:
        "Change the number of memories displayed in the list. Range: 1-200. Default is 20.",
      inputSchema: z.object({
        limit: z.number().min(1).max(200).default(20),
      }),
      execute: async ({ limit }) => {
        return dispatchToMemories(ctx, "set_limit", { limit });
      },
    }),

    /** 5. Search memories by content */
    memories_search: tool({
      description:
        "Search memories by content substring. Filters the list to show only memories containing the search query.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search query to match against memory content"),
      }),
      execute: async ({ query }) => {
        let filtered: Memory[] = [];
        try {
          const memories = await getKgMemories({ limit: 100 });
          const lowerQ = query.toLowerCase();
          filtered = memories.filter((m) =>
            m.content.toLowerCase().includes(lowerQ),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "memories_search", args: { query } });
          ctx.emit({ type: "agent.tool.done", name: "memories_search", ok: false });
          return `Failed to search memories: ${msg}`;
        }
        const events: AgentEvent[] = [
          ...ensureMemoriesWindow(ctx),
          {
            type: "ui.tool",
            room: "memories" as WindowKind,
            tool: "search",
            args: { query, data: filtered },
          },
        ];
        return applyAndEmit(ctx, "memories_search", { query }, events);
      },
    }),

    /** 6. Filter by memory_type */
    memories_filter_by_type: tool({
      description:
        "Filter memories by memory type (fact, observation, preference, skill, goal, habit, insight). Pass empty string to clear the filter.",
      inputSchema: z.object({
        memory_type: z.union([MEMORY_TYPE, z.literal("")]).describe(
          "Memory type to filter by, or empty string to clear filter"
        ),
      }),
      execute: async ({ memory_type }) => {
        return dispatchToMemories(ctx, "filter_by_type", {
          memory_type: memory_type || undefined,
        });
      },
    }),

    /** 7. Filter memories by tag */
    memories_filter_by_tag: tool({
      description:
        "Filter memories by tag. Only memories containing the specified tag will be shown. Pass empty string to clear the filter.",
      inputSchema: z.object({
        tag: z.string().describe("Tag to filter by, or empty string to clear filter"),
      }),
      execute: async ({ tag }) => {
        return dispatchToMemories(ctx, "filter_by_tag", {
          tag: tag || undefined,
        });
      },
    }),

    /** 8. Open quick-add form for new memory */
    memories_quick_add: tool({
      description:
        "Open the quick-add form to create a new memory. Optionally pre-fill fields.",
      inputSchema: z.object({
        content: z.string().optional().describe("Optional pre-filled content"),
        memory_type: z.string().optional().describe("Optional memory type (default: fact)"),
        confidence: z.number().min(0).max(1).optional().describe("Optional confidence 0-1"),
        about_entity_id: z.string().optional().describe("Optional entity ID this memory is about"),
        about_integration_slug: z.string().optional().describe("Optional integration slug this memory relates to"),
      }),
      execute: async (input) => {
        // Persist to backend first if content is provided
        if (input.content) {
          try {
            await addMemory({
              content: input.content,
              memory_type: (input.memory_type as "fact" | "preference" | "action_pattern" | "decision" | "observation") ?? "fact",
              confidence: input.confidence,
              about_entity_id: input.about_entity_id,
              about_integration_slug: input.about_integration_slug,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.emit({ type: "agent.tool.start", name: "memories_quick_add", args: input });
            ctx.emit({ type: "agent.tool.done", name: "memories_quick_add", ok: false });
            return `Failed to add memory: ${msg}`;
          }
        }

        const events: AgentEvent[] = [
          ...ensureMemoriesWindow(ctx),
          {
            type: "ui.tool.open",
            kind: "memories" as WindowKind,
            payload: { quickAdd: true, ...input },
          },
        ];
        return applyAndEmit(ctx, "memories_quick_add", input, events);
      },
    }),

    /** 9. Read which entity a memory is about */
    memories_read_related_entity: tool({
      description:
        "Read the entity that a specific memory is about. Requires the memory ID.",
      inputSchema: z.object({
        memory_id: z.string().describe("The ID of the memory to look up"),
      }),
      execute: async ({ memory_id }) => {
        return dispatchToMemories(ctx, "read_related_entity", { memory_id });
      },
    }),

    /** 10. Read which integration a memory relates to */
    memories_read_related_integration: tool({
      description:
        "Read which integration a specific memory relates to. Requires the memory ID.",
      inputSchema: z.object({
        memory_id: z.string().describe("The ID of the memory to look up"),
      }),
      execute: async ({ memory_id }) => {
        return dispatchToMemories(ctx, "read_related_integration", { memory_id });
      },
    }),

    /** 11. Refresh memories from server */
    memories_refresh: tool({
      description:
        "Refresh the memories list from the server, fetching the latest data.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatchToMemories(ctx, "refresh", {});
      },
    }),

    /** 12. Export selected memories */
    memories_export_selected: tool({
      description:
        "Export the currently selected/filtered memories. Optionally specify format (json, csv).",
      inputSchema: z.object({
        format: z.enum(["json", "csv"]).default("json").describe("Export format"),
        filename: z.string().optional().describe("Optional custom filename"),
      }),
      execute: async ({ format, filename }) => {
        return dispatchToMemories(ctx, "export_selected", { format, filename });
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Type exports
 * ------------------------------------------------------------------ */

export type MemoriesWindowToolBag = ReturnType<typeof memoriesWindowTools>;
