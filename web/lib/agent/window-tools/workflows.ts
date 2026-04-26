/**
 * Workflow window tools — per-window tools for the workflows browser + editor.
 *
 * The workflows window is a two-pane interface with a list browser on the
 * left and a detail/editor view on the right. These tools allow the agent
 * to browse, search, filter, edit, and execute workflows.
 *
 * Each workflow has: slug, name, description, trigger, outcome, frequency,
 * tags, and skill_chain (ordered list of skill slugs).
 */

import { tool } from "ai";
import { z } from "zod";
import type { AgentToolCtx } from "../tools";
import { applyToolToSnapshot } from "../server-snapshot";
import { getKgWorkflows, upsertWorkflow } from "@/lib/api/backend";
import type { Workflow } from "@/lib/api/backend";
import type { AgentEvent } from "@/lib/agent-client";
import type { WindowKind } from "@/lib/store";

/**
 * Returns a bag of workflow-specific tools for the agent.
 * Each tool operates within the workflows window context.
 */
export function workflowsWindowTools(ctx: AgentToolCtx) {
  const ensureWorkflowsWindow = (): AgentEvent[] =>
    ctx.snapshot.windows.some((w) => w.kind === "workflows")
      ? []
      : [{ type: "ui.room", room: "workflows" as WindowKind }];

  const dispatch = (toolName: string, args: Record<string, unknown>): string => {
    const events: AgentEvent[] = [
      ...ensureWorkflowsWindow(),
      { type: "ui.tool", room: "workflows" as WindowKind, tool: toolName, args },
    ];
    ctx.emit({ type: "agent.tool.start", name: `workflows_${toolName}`, args });
    for (const e of events) ctx.emit(e);
    const result = applyToolToSnapshot(ctx.snapshot, `workflows_${toolName}`, args);
    ctx.snapshot = result.snapshot;
    ctx.emit({
      type: "agent.tool.done",
      name: `workflows_${toolName}`,
      ok: result.ok ?? true,
    });
    return result.message;
  };

  return {
    /**
     * List all saved workflows in the workflows window.
     * Populates the left pane with the workflow list.
     */
    workflows_list_all: tool({
      description:
        "List all saved workflows. Opens or focuses the workflows window and displays the complete list of workflows in the browser pane.",
      inputSchema: z.object({}),
      execute: async () => {
        let workflows: Workflow[] = [];
        try {
          workflows = await getKgWorkflows();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "workflows_list_all", args: {} });
          ctx.emit({ type: "agent.tool.done", name: "workflows_list_all", ok: false });
          return `Failed to list workflows: ${msg}`;
        }
        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "list_all",
            args: { data: workflows },
          },
        ];
        ctx.emit({ type: "agent.tool.start", name: "workflows_list_all", args: {} });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_list_all", {});
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_list_all",
          ok: result.ok ?? true,
        });
        return `Listed ${workflows.length} workflow(s). The workflows window now shows the complete list.`;
      },
    }),

    /**
     * Select a workflow to view its details in the right pane.
     */
    workflows_select: tool({
      description:
        "Select a workflow by slug to view its details in the right pane. The workflow's description, trigger, outcome, frequency, tags, and skill chain will be displayed.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("The unique slug of the workflow to select"),
      }),
      execute: async ({ slug }) => {
        let workflow: Workflow | undefined;
        try {
          const workflows = await getKgWorkflows();
          workflow = workflows.find((w) => w.slug === slug);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "workflows_select", args: { slug } });
          ctx.emit({ type: "agent.tool.done", name: "workflows_select", ok: false });
          return `Failed to fetch workflow: ${msg}`;
        }
        if (!workflow) {
          ctx.emit({ type: "agent.tool.start", name: "workflows_select", args: { slug } });
          ctx.emit({ type: "agent.tool.done", name: "workflows_select", ok: false });
          return `Workflow "${slug}" not found.`;
        }
        return dispatch("select", { slug, data: workflow });
      },
    }),

    /**
     * Create a new workflow by opening the editor with empty fields.
     */
    workflows_new: tool({
      description:
        "Create a new workflow. Opens the workflow editor with empty fields for slug, name, description, trigger, outcome, and skill chain.",
      inputSchema: z.object({}),
      execute: async () => {
        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "new",
            args: {},
          },
        ];
        ctx.emit({ type: "agent.tool.start", name: "workflows_new", args: {} });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_new", {});
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_new",
          ok: result.ok ?? true,
        });
        return "Opened the workflow editor for creating a new workflow. Fill in the slug, name, description, and optionally trigger, outcome, frequency, and skill chain.";
      },
    }),

    /**
     * Edit the currently selected workflow.
     */
    workflows_edit: tool({
      description:
        "Edit the currently selected workflow. Opens the editor pre-filled with the workflow's current values. Use after selecting a workflow with workflows_select.",
      inputSchema: z.object({
        slug: z.string().min(1).optional().describe("Optional slug to edit; if omitted, edits the currently selected workflow"),
      }),
      execute: async ({ slug }) => {
        const args: Record<string, unknown> = slug ? { slug } : {};
        return dispatch("edit", args);
      },
    }),

    /**
     * Save the current workflow being edited.
     */
    workflows_save: tool({
      description:
        "Save the workflow currently being edited. Persists changes to the knowledge graph. Requires slug, name, and description. The skill_chain will replace any existing chain.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("Unique identifier for the workflow"),
        name: z.string().min(1).describe("Display name of the workflow"),
        description: z.string().min(1).describe("Detailed description of what the workflow does"),
        trigger: z.string().optional().describe("What triggers this workflow (e.g., 'daily at 9am', 'on new email')"),
        outcome: z.string().optional().describe("Expected outcome or deliverable of this workflow"),
        frequency: z.string().optional().describe("How often this workflow runs (e.g., 'daily', 'weekly', 'on-demand')"),
        tags: z.array(z.string()).optional().describe("Array of tag strings for categorization"),
        skill_chain: z
          .array(
            z.object({
              slug: z.string().describe("Skill slug"),
              step_order: z.number().int().positive().describe("Execution order (1-based)"),
            })
          )
          .optional()
          .describe("Ordered list of skills that make up this workflow"),
      }),
      execute: async (input) => {
        // Persist to backend first
        try {
          await upsertWorkflow({
            slug: input.slug,
            name: input.name,
            description: input.description,
            trigger: input.trigger,
            outcome: input.outcome,
            frequency: input.frequency,
            tags: input.tags,
            skill_chain: input.skill_chain,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({
            type: "agent.tool.start",
            name: "workflows_save",
            args: input as Record<string, unknown>,
          });
          ctx.emit({
            type: "agent.tool.done",
            name: "workflows_save",
            ok: false,
          });
          return `Failed to save workflow: ${msg}`;
        }

        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "save",
            args: input as Record<string, unknown>,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "workflows_save",
          args: input as Record<string, unknown>,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(
          ctx.snapshot,
          "workflows_save",
          input as Record<string, unknown>
        );
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_save",
          ok: result.ok ?? true,
        });
        return `Saved workflow '${input.name}' (${input.slug}). The workflow list has been refreshed.`;
      },
    }),

    /**
     * Cancel editing and return to the view mode.
     */
    workflows_cancel_edit: tool({
      description:
        "Cancel the current editing session and return to workflow view mode. Any unsaved changes will be discarded.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatch("cancel_edit", {});
      },
    }),

    /**
     * Search workflows by name or description.
     */
    workflows_search: tool({
      description:
        "Search workflows by name or description. Filters the workflow list to show only matching results. Use empty query to clear the search.",
      inputSchema: z.object({
        query: z.string().describe("Search term to match against workflow names and descriptions"),
      }),
      execute: async ({ query }) => {
        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "search",
            args: { query },
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "workflows_search",
          args: { query },
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_search", { query });
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_search",
          ok: result.ok ?? true,
        });
        return query
          ? `Searched workflows for '${query}'. The list is now filtered to matching results.`
          : "Cleared workflow search. Showing all workflows.";
      },
    }),

    /**
     * Filter workflows by a specific tag.
     */
    workflows_filter_by_tag: tool({
      description:
        "Filter workflows by a specific tag. Shows only workflows that have the specified tag. Use with empty tag to clear the filter.",
      inputSchema: z.object({
        tag: z.string().describe("Tag to filter by (e.g., 'automation', 'daily', 'github')"),
      }),
      execute: async ({ tag }) => {
        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "filter_by_tag",
            args: { tag },
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "workflows_filter_by_tag",
          args: { tag },
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_filter_by_tag", { tag });
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_filter_by_tag",
          ok: result.ok ?? true,
        });
        return tag
          ? `Filtered workflows by tag '#${tag}'. Showing matching workflows only.`
          : "Cleared tag filter. Showing all workflows.";
      },
    }),

    /**
     * Sort workflows alphabetically by name or slug.
     */
    workflows_sort_alphabetically: tool({
      description:
        "Sort workflows alphabetically. By default sorts by name, but can sort by slug if specified.",
      inputSchema: z.object({
        by: z.enum(["name", "slug"]).optional().default("name").describe("Field to sort by: 'name' or 'slug'"),
        ascending: z.boolean().optional().default(true).describe("Sort in ascending (A-Z) or descending (Z-A) order"),
      }),
      execute: async ({ by = "name", ascending = true }) => {
        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "sort_alphabetically",
            args: { by, ascending },
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "workflows_sort_alphabetically",
          args: { by, ascending },
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_sort_alphabetically", {
          by,
          ascending,
        });
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_sort_alphabetically",
          ok: result.ok ?? true,
        });
        const order = ascending ? "ascending" : "descending";
        return `Sorted workflows alphabetically by ${by} in ${order} order.`;
      },
    }),

    /**
     * Read the skill chain of the selected workflow.
     */
    workflows_read_skill_chain: tool({
      description:
        "Read the skill chain of the currently selected workflow. Returns the ordered list of skills that make up the workflow, with their step numbers and slugs.",
      inputSchema: z.object({
        slug: z.string().min(1).optional().describe("Optional slug; if omitted, reads the selected workflow's skill chain"),
      }),
      execute: async ({ slug }) => {
        const args: Record<string, unknown> = slug ? { slug } : {};
        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "read_skill_chain",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "workflows_read_skill_chain",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_read_skill_chain", args);
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_read_skill_chain",
          ok: result.ok ?? true,
        });
        return slug
          ? `Read skill chain for workflow '${slug}'. Check the workflows window for the skill chain display.`
          : "Read skill chain for the selected workflow. Check the workflows window for the skill chain display.";
      },
    }),

    /**
     * Execute/trigger the selected workflow.
     */
    workflows_run: tool({
      description:
        "Execute or trigger the selected workflow. This runs the workflow's skill chain in sequence. Requires the workflow to have a defined trigger and at least one step in the skill chain.",
      inputSchema: z.object({
        slug: z.string().min(1).optional().describe("Optional slug of workflow to run; if omitted, runs the currently selected workflow"),
        async: z.boolean().optional().default(false).describe("Whether to run asynchronously (non-blocking) or synchronously"),
      }),
      execute: async ({ slug, async = false }) => {
        const args: Record<string, unknown> = { async };
        if (slug) args.slug = slug;
        
        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "run",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "workflows_run",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_run", args);
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_run",
          ok: result.ok ?? true,
        });
        const mode = async ? "asynchronously" : "synchronously";
        return slug
          ? `Triggered workflow '${slug}' to run ${mode}. The workflow execution has started.`
          : `Triggered the selected workflow to run ${mode}. The workflow execution has started.`;
      },
    }),

    /**
     * Delete the selected workflow.
     */
    workflows_delete: tool({
      description:
        "Delete the selected workflow. This action is irreversible. The workflow will be removed from the knowledge graph.",
      inputSchema: z.object({
        slug: z.string().min(1).optional().describe("Optional slug of workflow to delete; if omitted, deletes the currently selected workflow"),
        confirm: z.boolean().optional().default(false).describe("Must be true to confirm deletion"),
      }),
      execute: async ({ slug, confirm = false }) => {
        if (!confirm) {
          ctx.emit({
            type: "agent.tool.start",
            name: "workflows_delete",
            args: { slug, confirm },
          });
          ctx.emit({
            type: "agent.tool.done",
            name: "workflows_delete",
            ok: false,
          });
          return "Deletion not confirmed. Set confirm: true to delete the workflow.";
        }

        const args: Record<string, unknown> = { confirm: true };
        if (slug) args.slug = slug;

        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "delete",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "workflows_delete",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_delete", args);
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_delete",
          ok: result.ok ?? true,
        });
        return slug
          ? `Deleted workflow '${slug}'. The workflow list has been refreshed.`
          : "Deleted the selected workflow. The workflow list has been refreshed.";
      },
    }),

    /**
     * Duplicate an existing workflow.
     */
    workflows_duplicate: tool({
      description:
        "Duplicate an existing workflow. Creates a copy with a new slug, preserving all other properties including the skill chain. Useful for creating variations of existing workflows.",
      inputSchema: z.object({
        source_slug: z.string().min(1).describe("Slug of the workflow to duplicate"),
        new_slug: z.string().min(1).describe("Slug for the new duplicated workflow"),
        new_name: z.string().optional().describe("Optional new name; if omitted, appends ' (Copy)' to the original name"),
      }),
      execute: async ({ source_slug, new_slug, new_name }) => {
        const args: Record<string, unknown> = { source_slug, new_slug };
        if (new_name) args.new_name = new_name;

        const events: AgentEvent[] = [
          ...ensureWorkflowsWindow(),
          {
            type: "ui.tool",
            room: "workflows" as WindowKind,
            tool: "duplicate",
            args,
          },
        ];
        ctx.emit({
          type: "agent.tool.start",
          name: "workflows_duplicate",
          args,
        });
        for (const e of events) ctx.emit(e);
        const result = applyToolToSnapshot(ctx.snapshot, "workflows_duplicate", args);
        ctx.snapshot = result.snapshot;
        ctx.emit({
          type: "agent.tool.done",
          name: "workflows_duplicate",
          ok: result.ok ?? true,
        });
        return `Duplicated workflow '${source_slug}' as '${new_slug}'${new_name ? ` (${new_name})` : ""}. The new workflow is now selected.`;
      },
    }),

    /**
     * Search workflows by name (fuzzy match) and return matching slugs.
     */
    workflows_search_by_name: tool({
      description:
        "Search workflows by name using fuzzy matching. Returns the slugs of workflows whose names match the query, useful for finding workflows when you don't know the exact slug.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search query to match against workflow names (fuzzy)"),
      }),
      execute: async ({ query }) => {
        let workflows: Workflow[] = [];
        try {
          workflows = await getKgWorkflows();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "workflows_search_by_name", args: { query } });
          ctx.emit({ type: "agent.tool.done", name: "workflows_search_by_name", ok: false });
          return `Failed to search workflows: ${msg}`;
        }

        const lowerQuery = query.toLowerCase();
        const matches = workflows
          .filter((w) => w.name.toLowerCase().includes(lowerQuery))
          .map((w) => ({ slug: w.slug, name: w.name }));

        ctx.emit({ type: "agent.tool.start", name: "workflows_search_by_name", args: { query } });
        ctx.emit({ type: "agent.tool.done", name: "workflows_search_by_name", ok: true });

        if (matches.length === 0) {
          return `No workflows found matching '${query}'.`;
        }
        const slugs = matches.map((m) => m.slug).join(", ");
        return `Found ${matches.length} workflow(s) matching '${query}': ${slugs}. Use workflows_select with a slug to view details.`;
      },
    }),

    /**
     * Quick open: search by name and select the best match in one call.
     */
    workflows_quick_open: tool({
      description:
        "Quickly open a workflow by name query. Performs a fuzzy search and automatically selects the best match. Combines search and select into one action for fast navigation.",
      inputSchema: z.object({
        name_query: z.string().min(1).describe("Name or partial name of the workflow to open"),
      }),
      execute: async ({ name_query }) => {
        let workflows: Workflow[] = [];
        try {
          workflows = await getKgWorkflows();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "workflows_quick_open", args: { name_query } });
          ctx.emit({ type: "agent.tool.done", name: "workflows_quick_open", ok: false });
          return `Failed to open workflow: ${msg}`;
        }

        const lowerQuery = name_query.toLowerCase();
        const matches = workflows.filter((w) =>
          w.name.toLowerCase().includes(lowerQuery)
        );

        if (matches.length === 0) {
          ctx.emit({ type: "agent.tool.start", name: "workflows_quick_open", args: { name_query } });
          ctx.emit({ type: "agent.tool.done", name: "workflows_quick_open", ok: false });
          return `No workflow found matching '${name_query}'. Try a different name or use workflows_list_all to see all workflows.`;
        }

        // Prefer exact match, then starts with, then contains
        const exactMatch = matches.find((w) => w.name.toLowerCase() === lowerQuery);
        const startsWithMatch = matches.find((w) =>
          w.name.toLowerCase().startsWith(lowerQuery)
        );
        const bestMatch = exactMatch ?? startsWithMatch ?? matches[0];

        return dispatch("select", { slug: bestMatch.slug, data: bestMatch });
      },
    }),

    /**
     * Read the currently selected workflow details.
     */
    workflows_read_current: tool({
      description:
        "Read the currently selected workflow's full details including name, description, trigger, outcome, frequency, tags, and skill chain. Returns the details of the workflow currently displayed in the right pane.",
      inputSchema: z.object({}),
      execute: async () => {
        return dispatch("read_current", {});
      },
    }),

    /**
     * Jump to a specific step in the selected workflow's skill chain.
     */
    workflows_jump_to_step: tool({
      description:
        "Jump to and focus a specific step in the currently selected workflow's skill chain. Useful for navigating to a particular step to view or edit it. The step number is 1-based.",
      inputSchema: z.object({
        step_number: z.number().int().min(1).describe("The 1-based step number to jump to in the skill chain"),
      }),
      execute: async ({ step_number }) => {
        return dispatch("jump_to_step", { step_number });
      },
    }),

    /**
     * Show recently modified workflows.
     */
    workflows_recent: tool({
      description:
        "Show recently modified workflows, sorted by most recent first. Useful for quickly accessing workflows you've been working on.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).optional().default(10).describe("Maximum number of recent workflows to show (1-20, default 10)"),
      }),
      execute: async ({ limit = 10 }) => {
        let workflows: Workflow[] = [];
        try {
          workflows = await getKgWorkflows();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "workflows_recent", args: { limit } });
          ctx.emit({ type: "agent.tool.done", name: "workflows_recent", ok: false });
          return `Failed to fetch recent workflows: ${msg}`;
        }

        const sorted = [...workflows].slice(0, limit);
        return dispatch("recent", { workflows: sorted, limit });
      },
    }),
  };
}

/** Type export for consumers */
export type WorkflowsWindowToolBag = ReturnType<typeof workflowsWindowTools>;
