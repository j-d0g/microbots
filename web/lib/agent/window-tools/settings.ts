/**
 * Settings window tools — per-window tools for the settings/preferences panel.
 *
 * These tools allow the UI agent to read and modify user preferences
 * when working inside the settings window: user_id, ui_mode, quiet_mode,
 * integrations count, and backend health status.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind, UiMode } from "@/lib/store";
import type { AgentToolCtx } from "../tools";

/* ------------------------------------------------------------------ *
 *  Shared helpers
 * ------------------------------------------------------------------ */

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

/** Ensure the settings window is open/visible before dispatching. */
function ensureSettings(): AgentEvent[] {
  return [{ type: "ui.room", room: "settings" as WindowKind }];
}

/** Dispatch a settings-specific tool event. */
function dispatch(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const events: AgentEvent[] = [
    ...ensureSettings(),
    { type: "ui.tool", room: "settings" as WindowKind, tool: toolName, args },
  ];
  return applyAndEmit(ctx, `settings_${toolName}`, args, events);
}

/* ------------------------------------------------------------------ *
 *  Settings window tools
 * ------------------------------------------------------------------ */

export function settingsWindowTools(ctx: AgentToolCtx) {
  return {
    /** 1. Read all current settings values */
    settings_read_all: tool({
      description:
        "Read all current user preference settings: user_id, ui_mode, quiet_mode, integrations count, and backend health status. Returns a summary of the current configuration.",
      inputSchema: z.object({}),
      execute: async () => {
        const snap = ctx.snapshot;
        const userId = snap.user?.userId ?? null;
        const uiMode = snap.ui?.mode ?? "windowed";
        const integrations = snap.integrations ?? [];
        const connectedCount = integrations.filter(
          (i) => i.status === "ACTIVE",
        ).length;
        const backend = snap.backend;
        const surrealStatus = backend
          ? backend.surrealOk
            ? "online"
            : "offline"
          : "unknown";
        const composioStatus = backend
          ? backend.composioOk
            ? "online"
            : "offline"
          : "unknown";

        const result = applyToolToSnapshot(
          ctx.snapshot,
          "settings_read_all",
          {},
        );
        ctx.snapshot = result.snapshot;

        const lines = [
          "Current settings:",
          `- user_id: ${userId ?? "not set"}`,
          `- ui_mode: ${uiMode}`,
          `- integrations: ${connectedCount} connected (${integrations.length} total)`,
          `- surrealdb: ${surrealStatus}`,
          `- composio: ${composioStatus}`,
        ];
        return lines.join("\n");
      },
    }),

    /** 2. Update the user ID */
    settings_set_userid: tool({
      description:
        "Update the user ID (namespace key) for backend requests. This is used for Composio routes and attached as X-User-Id header on all KG requests.",
      inputSchema: z.object({
        user_id: z.string().min(1).describe("The new user ID to set"),
      }),
      execute: async ({ user_id }) => {
        const events: AgentEvent[] = [
          ...ensureSettings(),
          {
            type: "ui.tool",
            room: "settings" as WindowKind,
            tool: "set_userid",
            args: { user_id },
          },
        ];
        return applyAndEmit(ctx, "settings_set_userid", { user_id }, events);
      },
    }),

    /** 3. Change UI mode */
    settings_set_ui_mode: tool({
      description:
        "Change the UI mode between 'windowed' (multi-window canvas) and 'chat' (single-focus chat interface).",
      inputSchema: z.object({
        mode: z
          .enum(["windowed", "chat"])
          .describe("The UI mode to switch to"),
      }),
      execute: async ({ mode }) => {
        const events: AgentEvent[] = [
          ...ensureSettings(),
          {
            type: "ui.tool",
            room: "settings" as WindowKind,
            tool: "set_ui_mode",
            args: { mode },
          },
        ];
        const result = applyAndEmit(
          ctx,
          "settings_set_ui_mode",
          { mode },
          events,
        );
        return `UI mode changed to ${mode}. ${result}`;
      },
    }),

    /** 4. Toggle quiet mode on/off */
    settings_toggle_quiet_mode: tool({
      description:
        "Toggle quiet mode on or off. When quiet mode is enabled, the agent reduces non-essential notifications and status updates.",
      inputSchema: z.object({
        enabled: z
          .boolean()
          .optional()
          .describe(
            "Explicitly set quiet mode (true/false). If omitted, toggles the current state.",
          ),
      }),
      execute: async ({ enabled }) => {
        // Set quiet mode based on provided value or default to true
        const newState = enabled !== undefined ? enabled : true;

        const events: AgentEvent[] = [
          ...ensureSettings(),
          {
            type: "ui.tool",
            room: "settings" as WindowKind,
            tool: "toggle_quiet_mode",
            args: { enabled: newState },
          },
        ];
        const result = applyAndEmit(
          ctx,
          "settings_toggle_quiet_mode",
          { enabled: newState },
          events,
        );
        return `Quiet mode ${newState ? "enabled" : "disabled"}. ${result}`;
      },
    }),

    /** 5. Read list of connected integrations */
    settings_read_connections: tool({
      description:
        "Read the list of connected integrations (Composio toolkits) and their connection status.",
      inputSchema: z.object({}),
      execute: async () => {
        const integrations = ctx.snapshot.integrations ?? [];
        const active = integrations.filter((i) => i.status === "ACTIVE");
        const pending = integrations.filter((i) => i.status === "INITIATED");
        const failed = integrations.filter((i) => i.status === "FAILED");

        const result = applyToolToSnapshot(
          ctx.snapshot,
          "settings_read_connections",
          {},
        );
        ctx.snapshot = result.snapshot;

        if (integrations.length === 0) {
          return "No integrations configured.";
        }

        const lines = [
          `Integrations: ${integrations.length} total`,
          ...integrations.map(
            (i) =>
              `  - ${i.slug}: ${i.status}${i.status === "ACTIVE" ? " ✓" : ""}`,
          ),
          "",
          `Summary: ${active.length} active, ${pending.length} pending, ${failed.length} failed`,
        ];
        return lines.join("\n");
      },
    }),

    /** 6. Check SurrealDB and Composio health status */
    settings_check_health: tool({
      description:
        "Check the health status of backend services: SurrealDB and Composio. Returns online/offline status for each service.",
      inputSchema: z.object({}),
      execute: async () => {
        const backend = ctx.snapshot.backend;
        const surrealOk = backend?.surrealOk ?? false;
        const composioOk = backend?.composioOk ?? false;

        const result = applyToolToSnapshot(
          ctx.snapshot,
          "settings_check_health",
          {},
        );
        ctx.snapshot = result.snapshot;

        const lines = [
          "Backend health status:",
          `- SurrealDB: ${surrealOk ? "online ✓" : "offline ✗"}`,
          `- Composio: ${composioOk ? "online ✓" : "offline ✗"}`,
        ];

        if (!surrealOk || !composioOk) {
          lines.push("", "Warning: Some backend services are unavailable.");
        }

        return lines.join("\n");
      },
    }),

    /** 7. Open the integration connection flow */
    settings_open_connection_manager: tool({
      description:
        "Open the integrations window to manage and connect new toolkits (Composio integrations).",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          { type: "ui.room", room: "integrations" as WindowKind },
        ];
        const result = applyAndEmit(
          ctx,
          "settings_open_connection_manager",
          {},
          events,
        );
        return `Opened integration connection manager. ${result}`;
      },
    }),

    /** 8. Reset all preferences to defaults */
    settings_reset_preferences: tool({
      description:
        "Reset all user preferences to their default values. This includes user_id (cleared), ui_mode (windowed), and quiet_mode (off). Does not affect integrations or backend configuration.",
      inputSchema: z.object({
        confirm: z
          .boolean()
          .describe("Must be true to confirm the reset operation"),
      }),
      execute: async ({ confirm }) => {
        if (!confirm) {
          return "Reset cancelled. Set confirm=true to proceed with reset.";
        }

        const events: AgentEvent[] = [
          ...ensureSettings(),
          {
            type: "ui.tool",
            room: "settings" as WindowKind,
            tool: "reset_preferences",
            args: {},
          },
        ];
        const result = applyAndEmit(
          ctx,
          "settings_reset_preferences",
          { confirm: true },
          events,
        );
        return `All preferences reset to defaults. user_id cleared, ui_mode set to windowed, quiet_mode disabled. ${result}`;
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Type exports
 * ------------------------------------------------------------------ */

export type SettingsWindowToolBag = ReturnType<typeof settingsWindowTools>;
