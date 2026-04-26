/**
 * Wiki window tools — per-window tools for the wiki canvas.
 *
 * These tools allow the UI agent to interact with wiki pages when working
 * inside the wiki window. The wiki window shows wiki pages at paths with
 * content and revision history.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

/**
 * Wiki window tools factory.
 *
 * Returns an object of 13 tools the UI agent can use when working
 * inside the wiki window:
 *   1. wiki_read_page - Read content of current wiki page
 *   2. wiki_navigate_to - Navigate to a specific wiki path
 *   3. wiki_edit_page - Enter edit mode for current page
 *   4. wiki_save_page - Save changes to current page
 *   5. wiki_cancel_edit - Cancel editing and return to view
 *   6. wiki_list_children - List child pages of current path
 *   7. wiki_go_to_parent - Navigate to parent directory
 *   8. wiki_search - Search wiki pages by content
 *   9. wiki_read_revision_history - Read revision history of current page
 *   10. wiki_revert_to_revision - Revert page to a specific revision
 *   11. wiki_new_page - Create a new wiki page at a path
 *   12. wiki_delete_page - Delete current page
 *   13. wiki_go_to_index - Navigate to wiki index/root
 */
export function wikiWindowTools(ctx: AgentToolCtx) {
  /** Ensure the wiki window is open before dispatching wiki tools. */
  const ensureWiki = (): AgentEvent[] =>
    ctx.snapshot.windows.some((w) => w.kind === "wiki")
      ? []
      : [{ type: "ui.room", room: "wiki" as WindowKind }];

  /**
   * Helper that emits tool-start, wiki-specific UI events,
   * mutates the server-side snapshot mirror, and emits tool-done.
   */
  const dispatch = (toolName: string, args: Record<string, unknown>): string => {
    const events: AgentEvent[] = [
      ...ensureWiki(),
      { type: "ui.tool", room: "wiki" as WindowKind, tool: toolName, args },
    ];

    ctx.emit({ type: "agent.tool.start", name: `wiki_${toolName}`, args });
    for (const e of events) ctx.emit(e);
    const result = applyToolToSnapshot(ctx.snapshot, `wiki_${toolName}`, args);
    ctx.snapshot = result.snapshot;
    ctx.emit({
      type: "agent.tool.done",
      name: `wiki_${toolName}`,
      ok: result.ok ?? true,
    });
    return result.message;
  };

  return {
    /**
     * Read the content of the current wiki page.
     * Returns the page content, metadata, and current revision.
     */
    wiki_read_page: tool({
      description:
        "Read the content of the current wiki page. Returns the page content, metadata, and current revision number.",
      inputSchema: z.object({}),
      execute: async () => dispatch("read_page", {}),
    }),

    /**
     * Navigate to a specific wiki path.
     * Changes the current page to the specified path.
     */
    wiki_navigate_to: tool({
      description:
        "Navigate to a specific wiki path. Changes the current page to the specified path (e.g., 'docs/getting-started', 'projects/roadmap').",
      inputSchema: z.object({
        path: z.string().min(1).describe("The wiki path to navigate to"),
      }),
      execute: async ({ path }) => dispatch("navigate_to", { path }),
    }),

    /**
     * Enter edit mode for the current page.
     * Switches the wiki view to edit mode with the current content loaded.
     */
    wiki_edit_page: tool({
      description:
        "Enter edit mode for the current wiki page. Switches the view to edit mode with the current content loaded for editing.",
      inputSchema: z.object({}),
      execute: async () => dispatch("edit_page", {}),
    }),

    /**
     * Save changes to the current page.
     * Commits the edited content as a new revision.
     */
    wiki_save_page: tool({
      description:
        "Save changes to the current wiki page. Commits the edited content as a new revision with an optional edit summary.",
      inputSchema: z.object({
        content: z.string().describe("The new page content"),
        edit_summary: z
          .string()
          .optional()
          .describe("Optional summary of the changes made"),
      }),
      execute: async ({ content, edit_summary }) =>
        dispatch("save_page", { content, edit_summary }),
    }),

    /**
     * Cancel editing and return to view mode.
     * Discards any unsaved changes and exits edit mode.
     */
    wiki_cancel_edit: tool({
      description:
        "Cancel editing and return to view mode. Discards any unsaved changes and exits edit mode.",
      inputSchema: z.object({}),
      execute: async () => dispatch("cancel_edit", {}),
    }),

    /**
     * List child pages of the current path.
     * Returns a list of subpages/directories under the current path.
     */
    wiki_list_children: tool({
      description:
        "List child pages of the current wiki path. Returns a list of subpages and directories under the current path.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "Optional path to list children for (defaults to current path)"
          ),
      }),
      execute: async ({ path }) => dispatch("list_children", { path: path ?? null }),
    }),

    /**
     * Navigate to the parent directory.
     * Moves up one level in the wiki path hierarchy.
     */
    wiki_go_to_parent: tool({
      description:
        "Navigate to the parent directory. Moves up one level in the wiki path hierarchy.",
      inputSchema: z.object({}),
      execute: async () => dispatch("go_to_parent", {}),
    }),

    /**
     * Search wiki pages by content.
     * Finds pages matching the search query in their title or content.
     */
    wiki_search: tool({
      description:
        "Search wiki pages by content. Finds pages matching the search query in their title or content.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The search query string"),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Maximum number of results to return"),
      }),
      execute: async ({ query, limit }) => dispatch("search", { query, limit }),
    }),

    /**
     * Read revision history of the current page.
     * Returns a list of all revisions with timestamps and authors.
     */
    wiki_read_revision_history: tool({
      description:
        "Read the revision history of the current wiki page. Returns a list of all revisions with timestamps, authors, and edit summaries.",
      inputSchema: z.object({
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Maximum number of revisions to return"),
      }),
      execute: async ({ limit }) => dispatch("read_revision_history", { limit }),
    }),

    /**
     * Revert page to a specific revision.
     * Restores the page content to a previous revision.
     */
    wiki_revert_to_revision: tool({
      description:
        "Revert the current wiki page to a specific revision. Restores the page content to a previous revision by its revision number or ID.",
      inputSchema: z.object({
        revision: z
          .union([z.number(), z.string()])
          .describe("The revision number or ID to revert to"),
        reason: z
          .string()
          .optional()
          .describe("Optional reason for the revert"),
      }),
      execute: async ({ revision, reason }) =>
        dispatch("revert_to_revision", { revision, reason: reason ?? null }),
    }),

    /**
     * Create a new wiki page at a path.
     * Creates a new page with the given path and optional initial content.
     */
    wiki_new_page: tool({
      description:
        "Create a new wiki page at the specified path. Creates a new page with the given path and optional initial content.",
      inputSchema: z.object({
        path: z.string().min(1).describe("The path for the new wiki page"),
        content: z
          .string()
          .optional()
          .default("")
          .describe("Optional initial content for the page"),
        title: z
          .string()
          .optional()
          .describe("Optional title for the page (defaults to path name)"),
      }),
      execute: async ({ path, content, title }) =>
        dispatch("new_page", { path, content: content ?? "", title: title ?? null }),
    }),

    /**
     * Delete the current page.
     * Permanently removes the current wiki page.
     */
    wiki_delete_page: tool({
      description:
        "Delete the current wiki page. Permanently removes the page from the wiki. Use with caution.",
      inputSchema: z.object({
        confirm: z
          .boolean()
          .describe("Must be true to confirm deletion"),
      }),
      execute: async ({ confirm }) => dispatch("delete_page", { confirm }),
    }),

    /**
     * Navigate to wiki index/root.
     * Returns to the wiki home page or index.
     */
    wiki_go_to_index: tool({
      description:
        "Navigate to the wiki index/root. Returns to the wiki home page or index, showing the root of the wiki structure.",
      inputSchema: z.object({}),
      execute: async () => dispatch("go_to_index", {}),
    }),
  };
}

export type WikiWindowToolBag = ReturnType<typeof wikiWindowTools>;
