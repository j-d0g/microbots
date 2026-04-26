/**
 * Chats Summary window tools — per-window tools for the chats_summary canvas.
 *
 * These tools allow the UI agent to interact with the chats_summary window
 * which displays summary statistics of chat signals: total count, recent
 * activity, sources, and filtering capabilities.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

/* ------------------------------------------------------------------ *
 *  Enums and Schemas
 * ------------------------------------------------------------------ */

/** Signal level for chat importance classification */
const SIGNAL_LEVEL = z.enum(["low", "mid", "high"]);

/** Integration source types */
const SOURCE_TYPE = z.enum([
  "slack",
  "gmail",
  "github",
  "linear",
  "notion",
  "perplexity",
  "canvas",
  "canvas_agent",
]);

/** Sort direction */
const SORT_DIRECTION = z.enum(["asc", "desc"]);

/* ------------------------------------------------------------------ *
 *  Helper Functions
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

/** Ensure the chats_summary window is open before dispatching a tool */
function ensureChatsSummary(ctx: AgentToolCtx): AgentEvent[] {
  const isOpen = ctx.snapshot.windows.some((w) => w.kind === "chats_summary");
  return isOpen
    ? []
    : [{ type: "ui.room", room: "chats_summary" as WindowKind }];
}

/** Dispatch a tool event to the chats_summary window */
function dispatchChatsSummaryTool(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const events: AgentEvent[] = [
    ...ensureChatsSummary(ctx),
    {
      type: "ui.tool",
      room: "chats_summary" as WindowKind,
      tool: toolName,
      args,
    },
  ];
  return applyAndEmit(ctx, `chatsummary_${toolName}`, args, events);
}

/* ------------------------------------------------------------------ *
 *  Chats Summary Window Tools
 * ------------------------------------------------------------------ */

export function chatsSummaryWindowTools(ctx: AgentToolCtx) {
  return {
    /** Read chat summary statistics (total, by source, etc.) */
    chatsummary_read_stats: tool({
      description:
        "Read chat summary statistics including total count, breakdown by source, signal level distribution, and recent activity metrics.",
      inputSchema: z.object({
        include_inactive: z.boolean().optional().default(false),
      }),
      execute: async ({ include_inactive }) => {
        return dispatchChatsSummaryTool(ctx, "read_stats", {
          include_inactive,
        });
      },
    }),

    /** Read recent chat signals */
    chatsummary_read_recent: tool({
      description:
        "Read recent chat signals with pagination. Returns the most recent chat entries sorted by timestamp.",
      inputSchema: z.object({
        limit: z.number().min(1).max(100).optional().default(20),
        offset: z.number().min(0).optional().default(0),
      }),
      execute: async ({ limit, offset }) => {
        return dispatchChatsSummaryTool(ctx, "read_recent", { limit, offset });
      },
    }),

    /** Filter by source type (slack, gmail, etc.) */
    chatsummary_filter_by_source: tool({
      description:
        "Filter chat summary to show only chats from a specific source type (slack, gmail, github, linear, notion, perplexity, canvas).",
      inputSchema: z.object({
        source: SOURCE_TYPE,
        clear_others: z.boolean().optional().default(false),
      }),
      execute: async ({ source, clear_others }) => {
        return dispatchChatsSummaryTool(ctx, "filter_by_source", {
          source,
          clear_others,
        });
      },
    }),

    /** Filter by date range */
    chatsummary_filter_by_date_range: tool({
      description:
        "Filter chat summary by a date range. Provide ISO 8601 dates or relative descriptors like 'today', 'yesterday', 'last_7_days', 'last_30_days'.",
      inputSchema: z.object({
        from: z.string().min(1),
        to: z.string().min(1).optional(),
      }),
      execute: async ({ from, to }) => {
        return dispatchChatsSummaryTool(ctx, "filter_by_date_range", {
          from,
          to: to ?? "now",
        });
      },
    }),

    /** Sort by signal level (low, mid, high) */
    chatsummary_sort_by_signal_level: tool({
      description:
        "Sort chats by signal level (low, mid, high). By default shows high-signal chats first.",
      inputSchema: z.object({
        direction: SORT_DIRECTION.optional().default("desc"),
        filter_to: SIGNAL_LEVEL.optional(),
      }),
      execute: async ({ direction, filter_to }) => {
        return dispatchChatsSummaryTool(ctx, "sort_by_signal_level", {
          direction,
          filter_to: filter_to ?? null,
        });
      },
    }),

    /** Search chat content */
    chatsummary_search: tool({
      description:
        "Search through chat content for specific keywords, phrases, or content patterns. Returns matching chats with context.",
      inputSchema: z.object({
        query: z.string().min(1),
        search_in: z.enum(["content", "title", "both"]).optional().default("both"),
        case_sensitive: z.boolean().optional().default(false),
      }),
      execute: async ({ query, search_in, case_sensitive }) => {
        return dispatchChatsSummaryTool(ctx, "search", {
          query,
          search_in,
          case_sensitive,
        });
      },
    }),

    /** Read which entities are mentioned in chats */
    chatsummary_read_entity_mentions: tool({
      description:
        "Read entity mentions extracted from chat signals. Shows which people, teams, projects, or other entities are referenced across chat conversations.",
      inputSchema: z.object({
        entity_type: z.string().optional(),
        min_mentions: z.number().min(1).optional().default(1),
      }),
      execute: async ({ entity_type, min_mentions }) => {
        return dispatchChatsSummaryTool(ctx, "read_entity_mentions", {
          entity_type: entity_type ?? null,
          min_mentions,
        });
      },
    }),

    /** Open the original chat in source window */
    chatsummary_open_source_chat: tool({
      description:
        "Open the original chat in its source window (e.g., open Slack thread in Slack integration view, Gmail thread in Gmail view).",
      inputSchema: z.object({
        chat_id: z.string().min(1),
        source_type: SOURCE_TYPE,
      }),
      execute: async ({ chat_id, source_type }) => {
        const events: AgentEvent[] = [
          ...ensureChatsSummary(ctx),
          {
            type: "ui.tool.open",
            kind: source_type as WindowKind,
            payload: { chat_id, source_type, view: "source_thread" },
          },
        ];
        return applyAndEmit(
          ctx,
          "chatsummary_open_source_chat",
          { chat_id, source_type },
          events
        );
      },
    }),

    /** Export chat summary as report */
    chatsummary_export_summary: tool({
      description:
        "Export the current chat summary view as a report (markdown, JSON, or CSV format). Includes applied filters and sorting.",
      inputSchema: z.object({
        format: z.enum(["markdown", "json", "csv"]).optional().default("markdown"),
        include_metadata: z.boolean().optional().default(true),
        filename: z.string().optional(),
      }),
      execute: async ({ format, include_metadata, filename }) => {
        return dispatchChatsSummaryTool(ctx, "export_summary", {
          format,
          include_metadata,
          filename: filename ?? `chat-summary-${Date.now()}`,
        });
      },
    }),

    /** Refresh chat data from server */
    chatsummary_refresh: tool({
      description:
        "Refresh chat data from the server, fetching the latest chat signals and updating the summary statistics.",
      inputSchema: z.object({
        force: z.boolean().optional().default(false),
      }),
      execute: async ({ force }) => {
        return dispatchChatsSummaryTool(ctx, "refresh", { force });
      },
    }),

    /** Group chats by integration source */
    chatsummary_read_by_integration: tool({
      description:
        "Group and read chats organized by their integration source. Shows a breakdown of chat activity per connected integration.",
      inputSchema: z.object({
        include_counts: z.boolean().optional().default(true),
        sort_by: z.enum(["count", "name", "recent"]).optional().default("count"),
      }),
      execute: async ({ include_counts, sort_by }) => {
        return dispatchChatsSummaryTool(ctx, "read_by_integration", {
          include_counts,
          sort_by,
        });
      },
    }),

    /** Jump to full chat window view */
    chatsummary_jump_to_full_chat: tool({
      description:
        "Jump from the chat summary view to the full chat window for detailed conversation view and interaction.",
      inputSchema: z.object({
        chat_id: z.string().optional(),
        focus_query: z.string().optional(),
      }),
      execute: async ({ chat_id, focus_query }) => {
        const events: AgentEvent[] = [
          ...ensureChatsSummary(ctx),
          {
            type: "ui.room",
            room: "chat" as WindowKind,
          },
        ];
        if (chat_id) {
          events.push({
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "focus_chat",
            args: { chat_id },
          });
        }
        if (focus_query) {
          events.push({
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "set_query",
            args: { query: focus_query },
          });
        }
        return applyAndEmit(
          ctx,
          "chatsummary_jump_to_full_chat",
          { chat_id: chat_id ?? null, focus_query: focus_query ?? null },
          events
        );
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Type Export
 * ------------------------------------------------------------------ */

export type ChatsSummaryWindowToolBag = ReturnType<typeof chatsSummaryWindowTools>;
