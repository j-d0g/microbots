/**
 * Chat window tools — per-window tools for the chat transcript.
 *
 * These tools allow the UI agent to navigate and manipulate the chat
 * history: scrolling, searching, filtering, reading recent context,
 * generating summaries, jumping to timestamps, and exporting.
 *
 * Follows the same pattern as graphTools in ../tools.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";
import { applyToolToSnapshot } from "../server-snapshot";

/**
 * Returns chat window tools bound to the provided context.
 * Each tool emits AgentEvents for UI updates and applies changes via applyToolToSnapshot.
 */
export function chatWindowTools(ctx: AgentToolCtx) {
  /** Ensure the chat window is open; returns events to emit if it wasn't. */
  const ensureChat = (): AgentEvent[] =>
    ctx.snapshot.windows.some((w) => w.kind === "chat")
      ? []
      : [{ type: "ui.room", room: "chat" as WindowKind }];

  /**
   * Helper to dispatch a chat tool event.
   * Emits the tool-start chip, UI events for the chat window, applies to snapshot,
   * and emits tool-done.
   */
  const dispatch = (toolName: string, args: Record<string, unknown>): string => {
    const events: AgentEvent[] = [
      ...ensureChat(),
      { type: "ui.tool", room: "chat" as WindowKind, tool: toolName, args },
    ];
    ctx.emit({ type: "agent.tool.start", name: `chat_${toolName}`, args });
    for (const e of events) ctx.emit(e);
    const result = applyToolToSnapshot(ctx.snapshot, `chat_${toolName}`, args);
    ctx.snapshot = result.snapshot;
    ctx.emit({
      type: "agent.tool.done",
      name: `chat_${toolName}`,
      ok: result.ok ?? true,
    });
    return result.message;
  };

  return {
    /**
     * Scroll to the beginning of the chat history.
     * Useful when the user wants to review how the conversation started.
     */
    chat_scroll_to_top: tool({
      description:
        "Scroll to the beginning of the chat history (oldest messages).",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          ...ensureChat(),
          {
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "scroll_to_top",
            args: {},
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "chat_scroll_to_top",
          args: {},
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(
          ctx.snapshot,
          "chat_scroll_to_top",
          {},
        );
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "chat_scroll_to_top",
          ok: result.ok ?? true,
        });
        return "Scrolled to the beginning of the chat history.";
      },
    }),

    /**
     * Scroll to the most recent message in the chat.
     * Returns the view to the bottom of the transcript.
     */
    chat_scroll_to_bottom: tool({
      description:
        "Scroll to the most recent message (bottom of the chat).",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          ...ensureChat(),
          {
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "scroll_to_bottom",
            args: {},
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "chat_scroll_to_bottom",
          args: {},
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(
          ctx.snapshot,
          "chat_scroll_to_bottom",
          {},
        );
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "chat_scroll_to_bottom",
          ok: result.ok ?? true,
        });
        return "Scrolled to the most recent message.";
      },
    }),

    /**
     * Search for messages containing a specific term.
     * Highlights matching messages in the chat window.
     */
    chat_search_messages: tool({
      description:
        "Search for messages containing a specific term. Highlights matches in the chat window.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The search term to look for"),
        case_sensitive: z.boolean().optional().default(false),
      }),
      execute: async ({ query, case_sensitive }) => {
        const args = { query, case_sensitive };
        const events: AgentEvent[] = [
          ...ensureChat(),
          {
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "search_messages",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "chat_search_messages",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(
          ctx.snapshot,
          "chat_search_messages",
          args,
        );
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "chat_search_messages",
          ok: result.ok ?? true,
        });
        return `Searched for "${query}" in chat messages (case ${case_sensitive ? "sensitive" : "insensitive"}).`;
      },
    }),

    /**
     * Filter the chat view to show only messages from a specific role.
     * Useful for reviewing only user inputs or only agent responses.
     */
    chat_filter_by_role: tool({
      description:
        "Filter the chat view to show only 'user' or 'agent' messages. Pass empty string to clear filter.",
      inputSchema: z.object({
        role: z
          .enum(["user", "agent", ""])
          .describe("Role to filter by, or empty string to clear"),
      }),
      execute: async ({ role }) => {
        const args = { role };
        const events: AgentEvent[] = [
          ...ensureChat(),
          {
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "filter_by_role",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "chat_filter_by_role",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(
          ctx.snapshot,
          "chat_filter_by_role",
          args,
        );
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "chat_filter_by_role",
          ok: result.ok ?? true,
        });
        if (role === "") {
          return "Cleared role filter; showing all messages.";
        }
        return `Filtered chat to show only ${role} messages.`;
      },
    }),

    /**
     * Read the last N messages from the chat history.
     * Useful for retrieving recent context for summarization or analysis.
     */
    chat_read_last_n: tool({
      description:
        "Read the last N messages for context. Returns message summaries without UI changes.",
      inputSchema: z.object({
        n: z
          .number()
          .min(1)
          .max(100)
          .default(10)
          .describe("Number of recent messages to retrieve"),
      }),
      execute: async ({ n }) => {
        const args = { n };
        // This is a read-only operation; still emit events for consistency
        ctx.emit({
          type: "agent.tool.start",
          name: "chat_read_last_n",
          args,
        });
        const result = applyToolToSnapshot(ctx.snapshot, "chat_read_last_n", args);
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "chat_read_last_n",
          ok: result.ok ?? true,
        });
        return `Retrieved the last ${n} messages from chat history.`;
      },
    }),

    /**
     * Generate a summary of the current conversation thread.
     * Creates a condensed overview of the chat content.
     */
    chat_summarize_thread: tool({
      description:
        "Generate a summary of the current conversation thread. Optionally limit to the last N messages.",
      inputSchema: z.object({
        last_n: z
          .number()
          .min(1)
          .optional()
          .describe("Optional: limit summary to last N messages"),
        focus: z
          .enum(["decisions", "actions", "questions", "full"])
          .default("full")
          .describe("What aspect to emphasize in the summary"),
      }),
      execute: async ({ last_n, focus }) => {
        const args = { last_n, focus };
        const events: AgentEvent[] = [
          ...ensureChat(),
          {
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "summarize_thread",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "chat_summarize_thread",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(
          ctx.snapshot,
          "chat_summarize_thread",
          args,
        );
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "chat_summarize_thread",
          ok: result.ok ?? true,
        });
        const scopeMsg = last_n ? ` (last ${last_n} messages)` : "";
        const focusMsg = focus !== "full" ? ` focusing on ${focus}` : "";
        return `Generated conversation summary${scopeMsg}${focusMsg}.`;
      },
    }),

    /**
     * Jump to a specific timestamp in the chat history.
     * Useful for navigating to a particular point in the conversation.
     */
    chat_jump_to_timestamp: tool({
      description:
        "Jump to a specific timestamp in the chat history. Scrolls the view to that point.",
      inputSchema: z.object({
        timestamp: z
          .number()
          .describe("Unix timestamp (ms) to jump to"),
        strategy: z
          .enum(["exact", "nearest_before", "nearest_after"])
          .default("nearest_after")
          .describe("How to handle the timestamp if no exact match exists"),
      }),
      execute: async ({ timestamp, strategy }) => {
        const args = { timestamp, strategy };
        const events: AgentEvent[] = [
          ...ensureChat(),
          {
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "jump_to_timestamp",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "chat_jump_to_timestamp",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(
          ctx.snapshot,
          "chat_jump_to_timestamp",
          args,
        );
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "chat_jump_to_timestamp",
          ok: result.ok ?? true,
        });
        const dateStr = new Date(timestamp).toLocaleString();
        return `Jumped to ${strategy} timestamp ${dateStr}.`;
      },
    }),

    /**
     * Export the current chat transcript to a file.
     * Supports text and markdown formats.
     */
    chat_export_transcript: tool({
      description:
        "Export the current chat transcript as text or markdown file.",
      inputSchema: z.object({
        format: z
          .enum(["text", "markdown"])
          .default("markdown")
          .describe("Export format"),
        filename: z
          .string()
          .optional()
          .describe("Optional custom filename (without extension)"),
        include_timestamps: z
          .boolean()
          .default(true)
          .describe("Include timestamps in the export"),
      }),
      execute: async ({ format, filename, include_timestamps }) => {
        const args = { format, filename, include_timestamps };
        const events: AgentEvent[] = [
          ...ensureChat(),
          {
            type: "ui.tool",
            room: "chat" as WindowKind,
            tool: "export_transcript",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "chat_export_transcript",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(
          ctx.snapshot,
          "chat_export_transcript",
          args,
        );
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "chat_export_transcript",
          ok: result.ok ?? true,
        });
        const ext = format === "markdown" ? ".md" : ".txt";
        const name = filename ? `${filename}${ext}` : `chat-export${ext}`;
        return `Exported chat transcript as ${name} (${format}, timestamps ${include_timestamps ? "included" : "excluded"}).`;
      },
    }),
  };
}

/** Type representing all chat window tools. */
export type ChatWindowToolBag = ReturnType<typeof chatWindowTools>;
