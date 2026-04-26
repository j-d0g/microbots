/**
 * Integration Detail Window Tools
 *
 * Per-window tools for the integration_detail window. These tools allow
 * the UI agent to read and manipulate integration details including
 * name, category, user_purpose, co_used_with, and related actions.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

/* ------------------------------------------------------------------ *
 *  Helper functions
 * ------------------------------------------------------------------ */

/** Emit agent tool start, UI events, apply to snapshot, emit tool done. */
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

/* ------------------------------------------------------------------ *
 *  Integration Detail Window Tools
 * ------------------------------------------------------------------ */

export function integrationDetailWindowTools(ctx: AgentToolCtx) {
  return {
    /** Read full details of current integration */
    integration_detail_read: tool({
      description:
        "Read the full details of the currently open integration including name, category, user_purpose, and co_used_with integrations.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool",
            room: "integration_detail" as WindowKind,
            tool: "read",
            args: {},
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_read",
          {},
          events,
        );
      },
    }),

    /** Update the user_purpose field */
    integration_detail_set_purpose: tool({
      description:
        "Update the user_purpose field for the current integration. This describes how the user uses this integration.",
      inputSchema: z.object({
        purpose: z.string().min(1).describe("The new user purpose description"),
      }),
      execute: async ({ purpose }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool",
            room: "integration_detail" as WindowKind,
            tool: "set_purpose",
            args: { purpose },
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_set_purpose",
          { purpose },
          events,
        );
      },
    }),

    /** Read list of commonly co-used integrations */
    integration_detail_read_co_used: tool({
      description:
        "Read the list of integrations commonly co-used with the current integration (integrations often used together).",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool",
            room: "integration_detail" as WindowKind,
            tool: "read_co_used",
            args: {},
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_read_co_used",
          {},
          events,
        );
      },
    }),

    /** Open detail window for a co-used integration */
    integration_detail_open_co_used: tool({
      description:
        "Open the detail window for a specific co-used integration by its slug or name.",
      inputSchema: z.object({
        integration_slug: z
          .string()
          .min(1)
          .describe("The slug or identifier of the co-used integration to open"),
      }),
      execute: async ({ integration_slug }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool.open",
            kind: "integration_detail" as WindowKind,
            payload: { slug: integration_slug },
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_open_co_used",
          { integration_slug },
          events,
        );
      },
    }),

    /** Read recent activities from this integration */
    integration_detail_read_recent_activities: tool({
      description:
        "Read recent activities, events, or usage data from the current integration.",
      inputSchema: z.object({
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Maximum number of recent activities to retrieve"),
      }),
      execute: async ({ limit }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool",
            room: "integration_detail" as WindowKind,
            tool: "read_recent_activities",
            args: { limit },
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_read_recent_activities",
          { limit },
          events,
        );
      },
    }),

    /** Open configuration/settings for this integration */
    integration_detail_configure: tool({
      description:
        "Open the configuration or settings panel for the current integration.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool",
            room: "integration_detail" as WindowKind,
            tool: "configure",
            args: {},
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_configure",
          {},
          events,
        );
      },
    }),

    /** Disconnect/remove this integration */
    integration_detail_disconnect: tool({
      description:
        "Disconnect or remove the current integration. This will revoke access and remove the integration from the user's account.",
      inputSchema: z.object({
        confirm: z
          .boolean()
          .optional()
          .default(false)
          .describe("Set to true to confirm the disconnect action"),
      }),
      execute: async ({ confirm }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool",
            room: "integration_detail" as WindowKind,
            tool: "disconnect",
            args: { confirm },
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_disconnect",
          { confirm },
          events,
        );
      },
    }),

    /** Refresh integration data from server */
    integration_detail_refresh_data: tool({
      description:
        "Refresh the integration data from the server, fetching the latest state and metadata.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool",
            room: "integration_detail" as WindowKind,
            tool: "refresh_data",
            args: {},
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_refresh_data",
          {},
          events,
        );
      },
    }),

    /** Read the integration category */
    integration_detail_read_category: tool({
      description:
        "Read the category of the current integration (e.g., messaging, project-management, calendar, etc.).",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool",
            room: "integration_detail" as WindowKind,
            tool: "read_category",
            args: {},
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_read_category",
          {},
          events,
        );
      },
    }),

    /** Return to integrations list view */
    integration_detail_go_back: tool({
      description:
        "Navigate back to the integrations list view from the current integration detail view.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          {
            type: "ui.room",
            room: "integrations" as WindowKind,
          },
        ];
        return applyAndEmit(
          ctx,
          "integration_detail_go_back",
          {},
          events,
        );
      },
    }),
  };
}

export type IntegrationDetailWindowToolBag = ReturnType<
  typeof integrationDetailWindowTools
>;
