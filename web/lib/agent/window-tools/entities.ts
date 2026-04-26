/**
 * Entities window tools — per-window tools for the entities list view.
 *
 * The entities window shows entity-type tabs + filtered list of entities.
 * Each entity has: name, type, aliases, tags, mention_count.
 *
 * These tools allow the UI agent to:
 *   - List/filter/sort entities
 *   - Switch between entity type tabs
 *   - Search entities
 *   - Open entity detail views
 *   - Add new entities
 *   - Refresh data from server
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

/* ------------------------------------------------------------------ *
 *  Shared helpers
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
  ctx.emit({ type: "agent.tool.done", name: toolName, ok: result.ok ?? true });
  return result.message;
}

/** Ensure the entities window is open before dispatching a tool. */
function ensureEntitiesWindow(): AgentEvent[] {
  return [{ type: "ui.room", room: "entities" as WindowKind }];
}

/** Dispatch a tool to the entities window. */
function dispatchToEntities(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const events: AgentEvent[] = [
    ...ensureEntitiesWindow(),
    { type: "ui.tool", room: "entities" as WindowKind, tool: toolName, args },
  ];
  return applyAndEmit(ctx, `entities_${toolName}`, args, events);
}

/* ------------------------------------------------------------------ *
 *  Entities window tools
 * ------------------------------------------------------------------ */

export function entitiesWindowTools(ctx: AgentToolCtx) {
  return {
    /** List entities filtered by entity type */
    entities_list_by_type: tool({
      description:
        "List entities filtered by a specific entity type (e.g., 'person', 'project', 'team', 'doc'). Shows all entities of that type with their names, aliases, tags, and mention counts.",
      inputSchema: z.object({
        entity_type: z
          .string()
          .min(1)
          .describe("The entity type to filter by (e.g., 'person', 'project')"),
      }),
      execute: async ({ entity_type }) => {
        return dispatchToEntities(ctx, "list_by_type", { entity_type });
      },
    }),

    /** Switch to a different entity type tab */
    entities_switch_type_tab: tool({
      description:
        "Switch the entities window to display a different entity type tab. This updates the active tab and refreshes the entity list to show only entities of the selected type.",
      inputSchema: z.object({
        entity_type: z
          .string()
          .min(1)
          .describe("The entity type tab to switch to"),
      }),
      execute: async ({ entity_type }) => {
        return dispatchToEntities(ctx, "switch_type_tab", { entity_type });
      },
    }),

    /** Search entities by name or alias */
    entities_search: tool({
      description:
        "Search for entities by name or alias. Returns entities whose name or any alias matches the search query (case-insensitive substring match).",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Search query to match against entity names and aliases"),
      }),
      execute: async ({ query }) => {
        return dispatchToEntities(ctx, "search", { query });
      },
    }),

    /** Sort entities by mention count */
    entities_sort_by_mentions: tool({
      description:
        "Sort the current entity list by mention count in descending order (most mentioned first). Useful for finding the most frequently referenced entities.",
      inputSchema: z.object({
        ascending: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, sort least-mentioned first; default is most-mentioned first"),
      }),
      execute: async ({ ascending = false }) => {
        return dispatchToEntities(ctx, "sort_by_mentions", { ascending });
      },
    }),

    /** Sort entities alphabetically */
    entities_sort_alphabetically: tool({
      description:
        "Sort the current entity list alphabetically by entity name. Default is A-Z; set ascending=false for Z-A.",
      inputSchema: z.object({
        ascending: z
          .boolean()
          .optional()
          .default(true)
          .describe("If true (default), sort A-Z; if false, sort Z-A"),
      }),
      execute: async ({ ascending = true }) => {
        return dispatchToEntities(ctx, "sort_alphabetically", { ascending });
      },
    }),

    /** Open entity_detail window for a specific entity */
    entities_open_detail: tool({
      description:
        "Open the entity detail window for a specific entity. Shows full entity information including description, all aliases, tags, mention history, and related integrations.",
      inputSchema: z.object({
        entity_id: z
          .string()
          .min(1)
          .describe("The entity ID to open (format: 'entity:{id}')"),
        name: z
          .string()
          .optional()
          .describe("Optional entity name for display purposes"),
        entity_type: z
          .string()
          .optional()
          .describe("Optional entity type for context"),
      }),
      execute: async ({ entity_id, name, entity_type }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool.open",
            kind: "entity_detail" as WindowKind,
            payload: {
              id: entity_id,
              name: name ?? entity_id,
              entity_type: entity_type ?? "unknown",
            },
          },
        ];
        return applyAndEmit(
          ctx,
          "entities_open_detail",
          { entity_id, name, entity_type },
          events,
        );
      },
    }),

    /** Open quick-add form for new entity */
    entities_quick_add: tool({
      description:
        "Open the quick-add form to create a new entity. Shows input fields for name and entity type. The form can be pre-filled with default values.",
      inputSchema: z.object({
        default_name: z
          .string()
          .optional()
          .describe("Optional default name to pre-fill in the form"),
        default_type: z
          .string()
          .optional()
          .describe("Optional default entity type to pre-select"),
      }),
      execute: async ({ default_name, default_type }) => {
        const events: AgentEvent[] = [
          ...ensureEntitiesWindow(),
          {
            type: "ui.tool",
            room: "entities" as WindowKind,
            tool: "quick_add",
            args: { default_name, default_type },
          },
        ];
        return applyAndEmit(
          ctx,
          "entities_quick_add",
          { default_name, default_type },
          events,
        );
      },
    }),

    /** Get list of available entity types with counts */
    entities_read_types: tool({
      description:
        "Retrieve the list of all available entity types with their counts. Returns each entity type (e.g., 'person', 'project') and how many entities exist of that type. Useful for understanding the entity landscape before filtering.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatchToEntities(ctx, "read_types", {});
      },
    }),

    /** Filter entities by tag */
    entities_filter_by_tag: tool({
      description:
        "Filter the current entity list to show only entities that have a specific tag. Tags are user-defined labels attached to entities for organization.",
      inputSchema: z.object({
        tag: z.string().min(1).describe("The tag to filter by"),
      }),
      execute: async ({ tag }) => {
        return dispatchToEntities(ctx, "filter_by_tag", { tag });
      },
    }),

    /** Refresh entities from server */
    entities_refresh_list: tool({
      description:
        "Refresh the entity list and type counts from the server. Fetches the latest data, including any newly created or modified entities since the last load.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatchToEntities(ctx, "refresh_list", {});
      },
    }),

    /** Find entities by name with fuzzy matching */
    entities_find_by_name: tool({
      description:
        "Fuzzy search for entities by name or alias. Returns candidate entities matching the provided name, useful for finding entities when the exact name is uncertain. Returns list of matches with confidence scores.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("Name or partial name to search for (fuzzy match)"),
        limit: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .default(5)
          .describe("Maximum number of candidate matches to return"),
      }),
      execute: async ({ name, limit }) => {
        return dispatchToEntities(ctx, "find_by_name", { name, limit });
      },
    }),

    /** Find people entities specifically */
    entities_find_people: tool({
      description:
        "Search specifically for person-type entities. Filters the entity list to show only people matching the query. Useful for finding team members, contacts, or individuals by name.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Search query to match against person names and aliases"),
      }),
      execute: async ({ query }) => {
        return dispatchToEntities(ctx, "find_people", { query });
      },
    }),

    /** Quick show - find and open entity detail in one call */
    entities_quick_show: tool({
      description:
        "Find an entity by name and immediately open its detail view. Combines search and detail view opening for quick entity inspection. If multiple matches found, opens the best match.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Entity name or alias to find and display"),
      }),
      execute: async ({ name }) => {
        return dispatchToEntities(ctx, "quick_show", { name });
      },
    }),

    /** Filter entities by minimum mention count */
    entities_filter_by_mention_count: tool({
      description:
        "Filter entities to show only those with at least a minimum number of mentions. Useful for finding frequently referenced or important entities.",
      inputSchema: z.object({
        min: z
          .number()
          .min(0)
          .describe("Minimum mention count threshold (inclusive)"),
      }),
      execute: async ({ min }) => {
        return dispatchToEntities(ctx, "filter_by_mention_count", { min });
      },
    }),

    /** Show recently mentioned entities */
    entities_recently_mentioned: tool({
      description:
        "Retrieve entities that have been mentioned recently in chats, ordered by recency. Useful for discovering active or trending topics and people.",
      inputSchema: z.object({
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Maximum number of recently mentioned entities to return"),
      }),
      execute: async ({ limit }) => {
        return dispatchToEntities(ctx, "recently_mentioned", { limit });
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Type exports
 * ------------------------------------------------------------------ */

export type EntitiesWindowToolBag = ReturnType<typeof entitiesWindowTools>;
