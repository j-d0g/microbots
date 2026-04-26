/**
 * Integrations window tool registry.
 *
 * Per-window tools for the integrations list view. These tools operate
 * within the integrations window context (filtering, sorting, searching)
 * and allow navigation to integration detail views.
 *
 * Pattern follows graphTools and v1WorkTools from ../tools.ts:
 * - Each tool validates input with Zod
 * - Emits AgentEvent via ctx.emit for UI updates
 * - Applies changes via applyToolToSnapshot
 * - Returns descriptive result string for the agent
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";
import type { AgentToolCtx } from "../tools";

/* ------------------------------------------------------------------ *
 *  Category enum for filtering
 * ------------------------------------------------------------------ */

export const INTEGRATION_CATEGORY = z.enum([
  "communication",
  "dev",
  "search",
  "productivity",
  "knowledge",
  "other",
]);

/* ------------------------------------------------------------------ *
 *  Integrations window tools
 * ------------------------------------------------------------------ */

export function integrationsWindowTools(ctx: AgentToolCtx) {
  /** Ensure the integrations window is open before dispatching tools. */
  const ensureIntegrationsWindow = (): AgentEvent[] =>
    ctx.snapshot.windows.some((w) => w.kind === "integrations")
      ? []
      : [{ type: "ui.room", room: "integrations" as WindowKind }];

  /** Dispatch a tool event to the integrations window. */
  const dispatch = (toolName: string, args: Record<string, unknown>): string => {
    const events: AgentEvent[] = [
      ...ensureIntegrationsWindow(),
      {
        type: "ui.tool",
        room: "integrations" as WindowKind,
        tool: toolName,
        args,
      },
    ];

    ctx.emit({ type: "agent.tool.start", name: toolName, args });
    for (const e of events) ctx.emit(e);
    const result = applyToolToSnapshot(ctx.snapshot, `integrations_${toolName}`, args);
    ctx.snapshot = result.snapshot;
    ctx.emit({
      type: "agent.tool.done",
      name: toolName,
      ok: result.ok ?? true,
    });
    return result.message;
  };

  return {
    /** List all connected integrations with their metadata. */
    integrations_list_all: tool({
      description:
        "List all connected integrations (Slack, GitHub, Linear, Gmail, Notion, Perplexity, etc.) with their metadata including name, category, description, and co-usage patterns. Use this to get a complete overview of available integrations.",
      inputSchema: z.object({}),
      execute: async () => dispatch("list_all", {}),
    }),

    /** Filter integrations by category (communication, dev, search, etc.). */
    integrations_filter_by_category: tool({
      description:
        "Filter the integrations list by category. Categories: communication (Slack, Gmail), dev (GitHub, Linear), search (Perplexity), productivity (Notion), knowledge, or other. Pass 'all' to clear the filter.",
      inputSchema: z.object({
        category: z.union([INTEGRATION_CATEGORY, z.literal("all")]),
      }),
      execute: async ({ category }) =>
        dispatch("filter_by_category", { category }),
    }),

    /** Sort integrations alphabetically by name. */
    integrations_sort_by_name: tool({
      description:
        "Sort the integrations list alphabetically by name (A-Z). This is the default sort order.",
      inputSchema: z.object({
        ascending: z.boolean().optional().default(true),
      }),
      execute: async ({ ascending }) =>
        dispatch("sort_by_name", { ascending }),
    }),

    /** Sort integrations by co-usage frequency. */
    integrations_sort_by_usage: tool({
      description:
        "Sort integrations by co-usage frequency (most frequently used together first). Use this to see which integrations are commonly activated together.",
      inputSchema: z.object({}),
      execute: async () => dispatch("sort_by_usage", {}),
    }),

    /** Search integrations by name or slug. */
    integrations_search: tool({
      description:
        "Search integrations by name or slug. Case-insensitive partial match. Use this to quickly find a specific integration.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => dispatch("search", { query }),
    }),

    /** Open the integration_detail window for a specific slug. */
    integrations_open_detail: tool({
      description:
        "Open the integration detail window for a specific integration by its slug (e.g., 'slack', 'github', 'linear', 'gmail', 'notion', 'perplexity'). This shows detailed information about the integration including entities, memories, and skills.",
      inputSchema: z.object({
        slug: z.string().min(1),
      }),
      execute: async ({ slug }) => {
        const toolName = "open_detail";
        const args = { slug };

        ctx.emit({ type: "agent.tool.start", name: toolName, args });

        // Open the integration_detail window via ui.room with slug
        const events: AgentEvent[] = [
          {
            type: "ui.room",
            room: "integration_detail" as WindowKind,
            slug,
            payload: { slug },
          },
        ];

        for (const e of events) ctx.emit(e);

        const result = applyToolToSnapshot(ctx.snapshot, `integrations_${toolName}`, args);
        ctx.snapshot = result.snapshot;

        ctx.emit({
          type: "agent.tool.done",
          name: toolName,
          ok: result.ok ?? true,
        });

        return `Opened integration detail for ${slug}.`;
      },
    }),

    /** Refresh the integrations list from the server. */
    integrations_refresh_list: tool({
      description:
        "Refresh the integrations list from the server. Use this to get the latest connection status and metadata for all integrations.",
      inputSchema: z.object({}),
      execute: async () => dispatch("refresh_list", {}),
    }),

    /** Read which integrations are commonly used together. */
    integrations_read_co_used: tool({
      description:
        "Read co-usage patterns for integrations. Shows which integrations are commonly used together. Optionally filter to a specific integration to see its co-usage partners.",
      inputSchema: z.object({
        slug: z.string().optional(),
      }),
      execute: async ({ slug }) => dispatch("read_co_used", { slug }),
    }),

    /** Get count of active vs total integrations. */
    integrations_count_active: tool({
      description:
        "Get the count of active vs total integrations. Returns statistics about connected and available integrations.",
      inputSchema: z.object({}),
      execute: async () => dispatch("count_active", {}),
    }),

    /** Open the composio_connect window to manage OAuth connections. */
    integrations_open_connect_manager: tool({
      description:
        "Open the integration connection manager (composio_connect window). Use this when the user wants to connect a new integration, authorize an app via OAuth, or enter an API key. Shows all available toolkits with their connection status.",
      inputSchema: z.object({}),
      execute: async () => {
        const toolName = "open_connect_manager";
        ctx.emit({ type: "agent.tool.start", name: toolName, args: {} });
        const events: AgentEvent[] = [
          { type: "ui.room", room: "composio_connect" as WindowKind },
        ];
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, `integrations_${toolName}`, {});
        ctx.snapshot = result.snapshot;
        ctx.emit({ type: "agent.tool.done", name: toolName, ok: result.ok ?? true });
        return "Opened the connection manager. Available integrations and their OAuth status are displayed.";
      },
    }),

    /** Check the connection status of a specific toolkit. */
    integrations_check_status: tool({
      description:
        "Check the connection status of a specific toolkit (e.g. 'slack', 'github', 'linear', 'gmail', 'notion', 'perplexityai'). Returns whether it is ACTIVE, INITIATED, EXPIRED, FAILED, or not connected.",
      inputSchema: z.object({
        toolkit: z.string().min(1).describe("The toolkit slug to check"),
      }),
      execute: async ({ toolkit }) => {
        const toolName = "check_status";
        const args = { toolkit };
        ctx.emit({ type: "agent.tool.start", name: toolName, args });

        const connection = (ctx.snapshot.integrations ?? []).find(
          (c: { slug: string; status: string }) => c.slug === toolkit,
        );

        const result = applyToolToSnapshot(ctx.snapshot, `integrations_${toolName}`, args);
        ctx.snapshot = result.snapshot;
        ctx.emit({ type: "agent.tool.done", name: toolName, ok: result.ok ?? true });

        if (!connection) {
          return `${toolkit}: not connected — open the connection manager to authorize it.`;
        }
        const labels: Record<string, string> = {
          ACTIVE: "connected and ready",
          INITIATED: "connection pending — authorize in the popup",
          EXPIRED: "expired — needs reauthorization",
          FAILED: "failed — try connecting again",
        };
        return `${toolkit}: ${labels[connection.status] ?? connection.status}.`;
      },
    }),

    /** Connect a specific toolkit via OAuth (opens the composio_connect window focused on that toolkit). */
    integrations_connect_toolkit: tool({
      description:
        "Initiate the OAuth connection flow for a specific toolkit. Opens the connection manager window so the user can authorize the integration. Use this when the user says 'connect slack', 'link github', etc.",
      inputSchema: z.object({
        toolkit: z
          .string()
          .min(1)
          .describe(
            "The toolkit slug to connect (slack, github, linear, gmail, notion, perplexityai)",
          ),
      }),
      execute: async ({ toolkit }) => {
        const toolName = "connect_toolkit";
        const args = { toolkit };
        ctx.emit({ type: "agent.tool.start", name: toolName, args });
        const events: AgentEvent[] = [
          {
            type: "ui.room",
            room: "composio_connect" as WindowKind,
            payload: { highlight: toolkit },
          } as AgentEvent,
        ];
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, `integrations_${toolName}`, args);
        ctx.snapshot = result.snapshot;
        ctx.emit({ type: "agent.tool.done", name: toolName, ok: result.ok ?? true });
        return `Opening connection manager for ${toolkit}. The user will need to authorize in the OAuth popup.`;
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Type exports
 * ------------------------------------------------------------------ */

export type IntegrationsWindowToolBag = ReturnType<typeof integrationsWindowTools>;
