/**
 * Profile window tools — per-window tool surface for the profile window.
 *
 * These tools allow the UI agent to read and manipulate user profile data:
 * name, role, goals, preferences, and context_window.
 *
 * Each tool:
 *   - Validates input with Zod schemas
 *   - Emits AgentEvent for UI updates via ctx.emit
 *   - Applies changes via applyToolToSnapshot
 *   - Returns a descriptive result string
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

/** Emit ui.tool.open with the profile window kind and payload. */
function emitProfileWindow(
  ctx: AgentToolCtx,
  toolName: string,
  args: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const events: AgentEvent[] = [
    {
      type: "ui.tool.open",
      kind: "profile" as WindowKind,
      payload: { ...payload, status: "done" },
    },
  ];
  return applyAndEmit(ctx, toolName, args, events);
}

/** Ensure the profile window is open for tool operations. */
function ensureProfileWindow(ctx: AgentToolCtx): AgentEvent[] {
  return ctx.snapshot.windows.some((w) => w.kind === "profile")
    ? []
    : [{ type: "ui.room", room: "profile" as WindowKind }];
}

/** Build profile update payload for partial updates. */
function buildProfilePayload(
  field: string,
  value: unknown,
): Record<string, unknown> {
  return { [field]: value, _updatedAt: Date.now() };
}

/**
 * Profile window tools factory.
 * Returns an object of 9 callable tools for profile manipulation.
 */
export function profileWindowTools(ctx: AgentToolCtx) {
  return {
    /** 1. Read all profile fields */
    profile_read_all: tool({
      description:
        "Read all profile fields (name, role, goals, preferences, context_window). Returns the current profile state.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool",
            room: "profile" as WindowKind,
            tool: "read_all",
            args: {},
          },
        ];
        return applyAndEmit(ctx, "profile_read_all", {}, events);
      },
    }),

    /** 2. Update user name */
    profile_set_name: tool({
      description: "Update the user's display name in their profile.",
      inputSchema: z.object({
        name: z.string().min(1).max(100),
      }),
      execute: async ({ name }) => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool.update",
            kind: "profile" as WindowKind,
            payload: buildProfilePayload("name", name),
          },
        ];
        return applyAndEmit(ctx, "profile_set_name", { name }, events);
      },
    }),

    /** 3. Update user role/position */
    profile_set_role: tool({
      description:
        "Update the user's role or position (e.g., 'Engineer', 'Product Manager').",
      inputSchema: z.object({
        role: z.string().min(1).max(100),
      }),
      execute: async ({ role }) => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool.update",
            kind: "profile" as WindowKind,
            payload: buildProfilePayload("role", role),
          },
        ];
        return applyAndEmit(ctx, "profile_set_role", { role }, events);
      },
    }),

    /** 4. Add a goal to the goals list */
    profile_add_goal: tool({
      description: "Add a new goal to the user's goals list. Goals are stored as strings.",
      inputSchema: z.object({
        goal: z.string().min(1).max(500),
      }),
      execute: async ({ goal }) => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool.update",
            kind: "profile" as WindowKind,
            payload: { _addGoal: goal, _updatedAt: Date.now() },
          },
        ];
        return applyAndEmit(ctx, "profile_add_goal", { goal }, events);
      },
    }),

    /** 5. Remove a goal by index */
    profile_remove_goal: tool({
      description:
        "Remove a goal from the goals list by its 0-based index. Use profile_read_all to see current goals and their indices.",
      inputSchema: z.object({
        index: z.number().int().min(0),
      }),
      execute: async ({ index }) => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool.update",
            kind: "profile" as WindowKind,
            payload: { _removeGoalIndex: index, _updatedAt: Date.now() },
          },
        ];
        return applyAndEmit(ctx, "profile_remove_goal", { index }, events);
      },
    }),

    /** 6. Set context window size */
    profile_set_context_window: tool({
      description:
        "Set the context window size (token limit). Valid range: 512 to 200000.",
      inputSchema: z.object({
        context_window: z.number().int().min(512).max(200000),
      }),
      execute: async ({ context_window }) => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool.update",
            kind: "profile" as WindowKind,
            payload: buildProfilePayload("context_window", context_window),
          },
        ];
        return applyAndEmit(
          ctx,
          "profile_set_context_window",
          { context_window },
          events,
        );
      },
    }),

    /** 7. Set a custom preference key-value pair */
    profile_set_preference: tool({
      description:
        "Set a custom preference as a key-value pair. The value can be any JSON-serializable type.",
      inputSchema: z.object({
        key: z.string().min(1).max(100),
        value: z.unknown(),
      }),
      execute: async ({ key, value }) => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool.update",
            kind: "profile" as WindowKind,
            payload: {
              _setPreference: { key, value },
              _updatedAt: Date.now(),
            },
          },
        ];
        return applyAndEmit(ctx, "profile_set_preference", { key, value }, events);
      },
    }),

    /** 8. Remove a preference by key */
    profile_remove_preference: tool({
      description:
        "Remove a custom preference by its key. Use profile_read_all to see current preference keys.",
      inputSchema: z.object({
        key: z.string().min(1).max(100),
      }),
      execute: async ({ key }) => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool.update",
            kind: "profile" as WindowKind,
            payload: { _removePreferenceKey: key, _updatedAt: Date.now() },
          },
        ];
        return applyAndEmit(ctx, "profile_remove_preference", { key }, events);
      },
    }),

    /** 9. Update the profile summary description */
    profile_update_summary: tool({
      description:
        "Update the profile summary description — a brief bio or description about the user.",
      inputSchema: z.object({
        summary: z.string().min(1).max(2000),
      }),
      execute: async ({ summary }) => {
        const events: AgentEvent[] = [
          ...ensureProfileWindow(ctx),
          {
            type: "ui.tool.update",
            kind: "profile" as WindowKind,
            payload: buildProfilePayload("summary", summary),
          },
        ];
        return applyAndEmit(ctx, "profile_update_summary", { summary }, events);
      },
    }),
  };
}

/** Type alias for the profile tool bag */
export type ProfileWindowToolBag = ReturnType<typeof profileWindowTools>;
