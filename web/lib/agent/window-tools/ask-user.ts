/**
 * Window-specific tools for the ask_user modal.
 *
 * These tools allow the UI agent to control and update the ask_user modal
 * window when working inside it. The ask_user modal is a focus card that
 * asks the user a question with optional multiple-choice options.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";

/* ------------------------------------------------------------------ *
 *  Enums (Zod) for ask_user modal options
 * ------------------------------------------------------------------ */

/** Position options for the ask_user modal */
const MODAL_POSITION = z.enum(["center", "bottom", "corner"]);

/** Priority levels affecting visual treatment */
const PRIORITY_LEVEL = z.enum(["low", "normal", "high"]);

/* ------------------------------------------------------------------ *
 *  askUserWindowTools — per-window tools for ask_user modal
 * ------------------------------------------------------------------ */

export function askUserWindowTools(ctx: AgentToolCtx) {
  /** Helper to emit UI events for ask_user modal updates */
  const dispatch = (
    toolName: string,
    args: Record<string, unknown>,
    uiEvents: AgentEvent[],
  ): string => {
    const events: AgentEvent[] = [
      { type: "agent.tool.start", name: toolName, args },
      ...uiEvents,
    ];
    const result = applyToolToSnapshot(ctx.snapshot, toolName, args);
    ctx.snapshot = result.snapshot;
    ctx.emit({ type: "agent.tool.done", name: toolName, ok: result.ok ?? true });
    return result.message;
  };

  return {
    /** Set or update the question text being asked in the modal */
    askuser_set_question: tool({
      description:
        "Set or update the question text being displayed in the ask_user modal. Replaces the current question.",
      inputSchema: z.object({
        question: z.string().min(1).max(500),
      }),
      execute: async ({ question }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool.update",
            kind: "ask_user",
            payload: { question },
          },
        ];
        return dispatch("askuser_set_question", { question }, events);
      },
    }),

    /** Set or update the multiple choice options (max 4) */
    askuser_set_options: tool({
      description:
        "Set or update the multiple-choice options for the ask_user modal. Max 4 options. Pass empty array for free-text input.",
      inputSchema: z.object({
        options: z.array(z.string().min(1).max(100)).max(4),
      }),
      execute: async ({ options }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool.update",
            kind: "ask_user",
            payload: { options },
          },
        ];
        return dispatch("askuser_set_options", { options }, events);
      },
    }),

    /** Signal that the agent is waiting for user response */
    askuser_await_response: tool({
      description:
        "Signal that the agent is now waiting for the user to respond to the ask_user modal. Updates the modal state to show a loading/waiting indicator.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool.update",
            kind: "ask_user",
            payload: { status: "awaiting_response" },
          },
        ];
        return dispatch("askuser_await_response", {}, events);
      },
    }),

    /** Close the ask_user modal without a response */
    askuser_close_modal: tool({
      description:
        "Close the ask_user modal window without waiting for or using a user response. Use when the question is no longer relevant or was answered through other means.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async ({ reason }) => {
        const events: AgentEvent[] = [
          { type: "ui.close_window", room: "ask_user" },
        ];
        return dispatch(
          "askuser_close_modal",
          { reason: reason ?? "closed_by_agent" },
          events,
        );
      },
    }),

    /** Read the user's response (if submitted) */
    askuser_read_response: tool({
      description:
        "Read the user's response from the ask_user modal if one has been submitted. Returns the selected option index (0-3) for multiple choice, or the text for free-text responses. Returns null if no response yet.",
      inputSchema: z.object({}),
      execute: async () => {
        // Find the ask_user window in the snapshot and read its response
        const askUserWindow = ctx.snapshot.windows.find(
          (w) => w.kind === "ask_user",
        );

        if (!askUserWindow) {
          return "Error: ask_user modal is not open";
        }

        // Response data would be tracked in the window's state
        // For now, return a success message indicating we're awaiting response
        return "Awaiting user response to the modal question."
      },
    }),

    /** Move modal to different position (center, bottom, corner) */
    askuser_change_modal_position: tool({
      description:
        "Change the position of the ask_user modal on screen. Options: center (default, centered), bottom (bottom of screen), corner (bottom-right corner).",
      inputSchema: z.object({
        position: MODAL_POSITION,
      }),
      execute: async ({ position }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool.update",
            kind: "ask_user",
            payload: { position },
          },
        ];
        return dispatch("askuser_change_modal_position", { position }, events);
      },
    }),

    /** Set priority level affecting visual treatment */
    askuser_set_priority: tool({
      description:
        "Set the priority level of the ask_user modal, affecting its visual treatment. Low (subtle), normal (default), high (prominent/urgent styling).",
      inputSchema: z.object({
        priority: PRIORITY_LEVEL,
      }),
      execute: async ({ priority }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool.update",
            kind: "ask_user",
            payload: { priority },
          },
        ];
        return dispatch("askuser_set_priority", { priority }, events);
      },
    }),

    /** Add a hint/explanation text below the question */
    askuser_add_hint: tool({
      description:
        "Add a hint or explanation text below the question in the ask_user modal. Useful for providing context, examples, or clarifying what kind of answer is expected.",
      inputSchema: z.object({
        hint: z.string().min(1).max(1000),
      }),
      execute: async ({ hint }) => {
        const events: AgentEvent[] = [
          {
            type: "ui.tool.update",
            kind: "ask_user",
            payload: { hint },
          },
        ];
        return dispatch("askuser_add_hint", { hint }, events);
      },
    }),
  };
}

export type AskUserWindowToolBag = ReturnType<typeof askUserWindowTools>;
