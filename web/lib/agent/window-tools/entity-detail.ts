/**
 * Entity Detail Window Tools
 *
 * Per-window tool surface for the entity_detail window.
 * These tools allow the UI agent to read and manipulate entity details:
 * name, entity_type, description, aliases, tags, chat_mention_count.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

/** Helper that emits the tool-start chip, the underlying UI events,
 *  mutates the server-side snapshot mirror, and emits tool-done. The
 *  return string is what the agent sees as the tool's result on its
 *  next step. */
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

/** Ensure the entity_detail window is open before dispatching tools.
 *  Returns empty array if already open, otherwise returns open event. */
function ensureEntityDetailWindow(ctx: AgentToolCtx, entityId?: string): AgentEvent[] {
  const alreadyOpen = ctx.snapshot.windows.some((w) => w.kind === "entity_detail");
  if (alreadyOpen) return [];
  const events: AgentEvent[] = [
    { type: "ui.room", room: "entity_detail" as WindowKind },
  ];
  if (entityId) {
    events[0] = { ...events[0], slug: entityId };
  }
  return events;
}

/** Dispatch a tool event to the entity_detail window. */
function dispatch(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
  entityId?: string,
): string {
  const events: AgentEvent[] = [
    ...ensureEntityDetailWindow(ctx, entityId),
    { type: "ui.tool", room: "entity_detail" as WindowKind, tool: toolName, args },
  ];
  return applyAndEmit(ctx, toolName, args, events);
}

/** Tools for working with entity details in the entity_detail window.
 *  These tools allow reading and modifying entity properties:
 *  - name, entity_type, description, aliases, tags, chat_mention_count
 *  - Related entities and mentions
 *  - Merge operations
 *  - Navigation back to entity list */
export function entityDetailWindowTools(ctx: AgentToolCtx) {
  return {
    /** Read full entity details including name, type, description,
     *  aliases, tags, and chat mention count. */
    entity_detail_read: tool({
      description:
        "Read full details for the current entity: name, entity_type, description, aliases, tags, and chat_mention_count. Pass entity_id to read a specific entity.",
      inputSchema: z.object({
        entity_id: z.string().optional().describe("Optional entity ID to read. Uses current entity if not provided."),
      }),
      execute: async ({ entity_id }) => {
        return dispatch(ctx, "entity_detail_read", { entity_id }, entity_id);
      },
    }),

    /** Update the entity description. */
    entity_detail_set_description: tool({
      description:
        "Update the description of the current entity. Pass entity_id to target a specific entity.",
      inputSchema: z.object({
        description: z.string().min(1).describe("New description text for the entity."),
        entity_id: z.string().optional().describe("Optional entity ID to update. Uses current entity if not provided."),
      }),
      execute: async ({ description, entity_id }) => {
        return dispatch(ctx, "entity_detail_set_description", { description, entity_id }, entity_id);
      },
    }),

    /** Add an alias to the entity. */
    entity_detail_add_alias: tool({
      description:
        "Add an alias (alternative name) to the current entity. Useful for capturing variations, nicknames, or alternative spellings.",
      inputSchema: z.object({
        alias: z.string().min(1).describe("Alias value to add."),
        entity_id: z.string().optional().describe("Optional entity ID to update. Uses current entity if not provided."),
      }),
      execute: async ({ alias, entity_id }) => {
        return dispatch(ctx, "entity_detail_add_alias", { alias, entity_id }, entity_id);
      },
    }),

    /** Remove an alias from the entity by value. */
    entity_detail_remove_alias: tool({
      description:
        "Remove an alias from the current entity by its exact value. The alias value must match exactly.",
      inputSchema: z.object({
        alias: z.string().min(1).describe("Exact alias value to remove."),
        entity_id: z.string().optional().describe("Optional entity ID to update. Uses current entity if not provided."),
      }),
      execute: async ({ alias, entity_id }) => {
        return dispatch(ctx, "entity_detail_remove_alias", { alias, entity_id }, entity_id);
      },
    }),

    /** Add a tag to the entity. */
    entity_detail_add_tag: tool({
      description:
        "Add a tag to the current entity for categorization and filtering.",
      inputSchema: z.object({
        tag: z.string().min(1).describe("Tag value to add."),
        entity_id: z.string().optional().describe("Optional entity ID to update. Uses current entity if not provided."),
      }),
      execute: async ({ tag, entity_id }) => {
        return dispatch(ctx, "entity_detail_add_tag", { tag, entity_id }, entity_id);
      },
    }),

    /** Remove a tag from the entity by value. */
    entity_detail_remove_tag: tool({
      description:
        "Remove a tag from the current entity by its exact value.",
      inputSchema: z.object({
        tag: z.string().min(1).describe("Exact tag value to remove."),
        entity_id: z.string().optional().describe("Optional entity ID to update. Uses current entity if not provided."),
      }),
      execute: async ({ tag, entity_id }) => {
        return dispatch(ctx, "entity_detail_remove_tag", { tag, entity_id }, entity_id);
      },
    }),

    /** Read chat mentions of this entity. */
    entity_detail_read_mentions: tool({
      description:
        "Read chat messages that mention the current entity. Returns the mention context and chat_mention_count.",
      inputSchema: z.object({
        entity_id: z.string().optional().describe("Optional entity ID. Uses current entity if not provided."),
        limit: z.number().min(1).max(100).optional().default(20).describe("Maximum number of mentions to return."),
      }),
      execute: async ({ entity_id, limit }) => {
        return dispatch(ctx, "entity_detail_read_mentions", { entity_id, limit }, entity_id);
      },
    }),

    /** Read related entities. */
    entity_detail_read_related: tool({
      description:
        "Read entities that are related to the current entity (co-mentioned, linked, or connected via relationships).",
      inputSchema: z.object({
        entity_id: z.string().optional().describe("Optional entity ID. Uses current entity if not provided."),
        limit: z.number().min(1).max(50).optional().default(10).describe("Maximum number of related entities to return."),
      }),
      execute: async ({ entity_id, limit }) => {
        return dispatch(ctx, "entity_detail_read_related", { entity_id, limit }, entity_id);
      },
    }),

    /** Merge this entity with another entity. */
    entity_detail_merge_with: tool({
      description:
        "Merge the current entity with another entity. The target entity's data (aliases, tags, mentions) will be incorporated. Use with caution - this operation is typically irreversible.",
      inputSchema: z.object({
        target_entity_id: z.string().min(1).describe("ID of the entity to merge into the current entity."),
        entity_id: z.string().optional().describe("Optional source entity ID. Uses current entity if not provided."),
        strategy: z.enum(["merge", "replace"]).optional().default("merge")
          .describe("Merge strategy: 'merge' combines data, 'replace' favors target data."),
      }),
      execute: async ({ target_entity_id, entity_id, strategy }) => {
        return dispatch(ctx, "entity_detail_merge_with", { target_entity_id, entity_id, strategy }, entity_id);
      },
    }),

    /** Read where the entity appears (integrations, chats). */
    entity_detail_read_appearances: tool({
      description:
        "Read all places where the entity appears: integrations (Slack, GitHub, etc.), chat channels, documents, and other sources.",
      inputSchema: z.object({
        entity_id: z.string().optional().describe("Optional entity ID. Uses current entity if not provided."),
        include_integrations: z.boolean().optional().default(true).describe("Include integration appearances."),
        include_chats: z.boolean().optional().default(true).describe("Include chat appearances."),
      }),
      execute: async ({ entity_id, include_integrations, include_chats }) => {
        return dispatch(ctx, "entity_detail_read_appearances", { entity_id, include_integrations, include_chats }, entity_id);
      },
    }),

    /** Return to entities list. */
    entity_detail_go_back: tool({
      description:
        "Close the entity detail window and return to the entities list view. Use when finished working with an entity.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          { type: "ui.close_window", room: "entity_detail" as WindowKind },
          { type: "ui.room", room: "entities" as WindowKind },
        ];
        return applyAndEmit(ctx, "entity_detail_go_back", {}, events);
      },
    }),
  };
}

/** Type export for consumers */
export type EntityDetailWindowToolBag = ReturnType<typeof entityDetailWindowTools>;
