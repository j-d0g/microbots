/**
 * Skills window tool registry.
 *
 * Tools for browsing, filtering, sorting, and managing reusable capabilities
 * (skills) in the skills window. Each tool emits AgentEvents for UI updates
 * and applies changes via applyToolToSnapshot.
 *
 * Skills have: slug, name, description, steps, frequency, strength, tags, uses_integrations.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "../server-snapshot";
import { getKgSkills } from "@/lib/api/backend";
import type { Skill } from "@/lib/api/backend";
import type { AgentToolCtx } from "../tools";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

/** Emit events and apply snapshot changes, returning a descriptive result. */
function dispatchWindowTool(
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

/** Build a ui.tool event targeting the skills window. */
function skillToolEvent(
  tool: string,
  args: Record<string, unknown>,
): AgentEvent {
  return {
    type: "ui.tool",
    room: "skills" as WindowKind,
    tool,
    args,
  };
}

/** Ensure the skills window is open. */
function ensureSkillsWindow(ctx: AgentToolCtx): AgentEvent[] {
  const hasSkills = ctx.snapshot.windows.some((w) => w.kind === "skills");
  return hasSkills ? [] : [{ type: "ui.room", room: "skills" as WindowKind }];
}

/* ------------------------------------------------------------------ *
 *  Schemas
 * ------------------------------------------------------------------ */

const SortDirection = z.enum(["asc", "desc"]);

/* ------------------------------------------------------------------ *
 *  Skills Window Tools
 * ------------------------------------------------------------------ */

export function skillsWindowTools(ctx: AgentToolCtx) {
  const dispatch = (toolName: string, args: Record<string, unknown>): string => {
    const events: AgentEvent[] = [
      ...ensureSkillsWindow(ctx),
      skillToolEvent(toolName, args),
    ];
    return dispatchWindowTool(ctx, `skills_${toolName}`, args, events);
  };

  return {
    /** 1. List all skills with current filter. */
    skills_list_all: tool({
      description:
        "List all skills in the skills window, applying the current filter state. Use this to view the complete skill catalog or refresh the current view.",
      inputSchema: z.object({}),
      execute: async () => {
        let skills: Skill[] = [];
        try {
          skills = await getKgSkills();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "skills_list_all", args: {} });
          ctx.emit({ type: "agent.tool.done", name: "skills_list_all", ok: false });
          return `Failed to list skills: ${msg}`;
        }
        const events: AgentEvent[] = [
          ...ensureSkillsWindow(ctx),
          skillToolEvent("list_all", { data: skills }),
        ];
        return dispatchWindowTool(ctx, "skills_list_all", {}, events);
      },
    }),

    /** 2. Filter skills by minimum strength level. */
    skills_filter_by_min_strength: tool({
      description:
        "Filter skills to show only those with strength >= the specified minimum. Strength typically ranges 1-100. Use this to find well-practiced, high-confidence capabilities.",
      inputSchema: z.object({
        min_strength: z.number().min(0).max(100).describe("Minimum strength threshold (inclusive)"),
      }),
      execute: async ({ min_strength }) => {
        return dispatch("filter_by_min_strength", { min_strength });
      },
    }),

    /** 3. Sort skills by strength. */
    skills_sort_by_strength: tool({
      description:
        "Sort skills by their strength level. Default is descending (strongest first). Use ascending to find skills that need more practice.",
      inputSchema: z.object({
        direction: SortDirection.optional().default("desc"),
      }),
      execute: async ({ direction }) => {
        return dispatch("sort_by_strength", { direction });
      },
    }),

    /** 4. Sort skills alphabetically. */
    skills_sort_alphabetically: tool({
      description:
        "Sort skills alphabetically by name. Default is ascending (A-Z). Useful for quickly scanning the skill catalog when you know the name.",
      inputSchema: z.object({
        direction: SortDirection.optional().default("asc"),
      }),
      execute: async ({ direction }) => {
        return dispatch("sort_alphabetically", { direction });
      },
    }),

    /** 5. Search skills by name or description. */
    skills_search: tool({
      description:
        "Search for skills by name or description substring. Case-insensitive partial match. Returns skills where name OR description contains the query.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search string to match against skill names and descriptions"),
      }),
      execute: async ({ query }) => {
        return dispatch("search", { query });
      },
    }),

    /** 6. Filter skills by tag. */
    skills_filter_by_tag: tool({
      description:
        "Filter skills to show only those with a specific tag. Tags categorize skills by domain (e.g., 'automation', 'research', 'communication').",
      inputSchema: z.object({
        tag: z.string().min(1).describe("Tag to filter by"),
      }),
      execute: async ({ tag }) => {
        return dispatch("filter_by_tag", { tag });
      },
    }),

    /** 7. Filter skills by integration dependency. */
    skills_filter_by_integration: tool({
      description:
        "Filter skills to show only those that use a specific integration (e.g., 'slack', 'github', 'linear', 'gmail', 'notion'). Useful when checking what capabilities are available for a connected tool.",
      inputSchema: z.object({
        integration: z.string().min(1).describe("Integration slug to filter by (e.g., 'slack', 'github')"),
      }),
      execute: async ({ integration }) => {
        return dispatch("filter_by_integration", { integration });
      },
    }),

    /** 8. Read full details of a specific skill. */
    skills_read_detail: tool({
      description:
        "Read the full details of a specific skill by its slug. Opens the skill detail view showing steps, frequency, strength, tags, and integrations.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("Unique slug identifier of the skill"),
      }),
      execute: async ({ slug }) => {
        return dispatch("read_detail", { slug });
      },
    }),

    /** 9. Increase strength of a skill. */
    skills_strengthen: tool({
      description:
        "Increase the strength of a skill, typically after successful execution. Strength increments reflect practice and confidence. Call this when a skill is used successfully.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("Slug of the skill to strengthen"),
        increment: z.number().min(1).max(10).optional().default(1).describe("Amount to increase strength by (1-10)"),
      }),
      execute: async ({ slug, increment }) => {
        return dispatch("strengthen", { slug, increment });
      },
    }),

    /** 10. Refresh skills from server. */
    skills_refresh_list: tool({
      description:
        "Refresh the skills list from the server, fetching the latest data. Use this when skills may have been updated externally or to ensure fresh data.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatch("refresh_list", {});
      },
    }),

    /** 11. Get count of skills at each strength level. */
    skills_count_by_strength: tool({
      description:
        "Get a distribution count of skills grouped by strength level buckets (e.g., 0-25, 26-50, 51-75, 76-100). Useful for assessing overall capability maturity.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatch("count_by_strength", {});
      },
    }),

    /** 12. Open workflows that use this skill. */
    skills_open_workflows_using: tool({
      description:
        "Open the workflows window filtered to show only workflows that include this skill in their chain. Useful for understanding where a skill is applied.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("Slug of the skill to find workflows for"),
      }),
      execute: async ({ slug }) => {
        const events: AgentEvent[] = [
          ...ensureSkillsWindow(ctx),
          skillToolEvent("open_workflows_using", { slug }),
          { type: "ui.room", room: "workflows" as WindowKind },
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "filter_by_skill",
            args: { skill_slug: slug },
          },
        ];
        return dispatchWindowTool(ctx, "skills_open_workflows_using", { slug }, events);
      },
    }),
  };
}

/* ------------------------------------------------------------------ *
 *  Types
 * ------------------------------------------------------------------ */

export type SkillsWindowToolBag = ReturnType<typeof skillsWindowTools>;
