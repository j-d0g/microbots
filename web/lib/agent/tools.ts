import { tool } from "ai";
import { z } from "zod";
import {
  addMemory,
  getKgEntities,
  getKgIntegrations,
  getKgMemories,
  getKgSkills,
  getKgUser,
  getKgWorkflows,
  getToday,
  searchKg,
  upsertEntity,
  upsertWorkflow,
} from "@/lib/api/backend";
import { toGraph } from "@/lib/api/kg-to-graph";
import { buildAdjacency, resolveNodeRef } from "@/components/graph/graph-view";
import type { AgentEvent } from "@/lib/agent-client";
import { applyCanvasToSnapshot } from "./server-snapshot";
import { canvasActionForEvent } from "./canvas-reducer";
import type { CanvasSnapshot } from "./types";

const SHOW_KIND = z.enum([
  "graph",
  "memories",
  "entities",
  "entity_detail",
  "workflows",
  "skills",
  "integrations",
  "integration_detail",
]);

export const AGENT_TOOL_DESCRIPTIONS = {
  show: "Open one focused graph, memory, entity, workflow, skill, or integration card.",
  close: "Close the open card or canvas.",
  search: "Search memories, entities, workflows, and integrations in the knowledge graph.",
  ask_user: "Ask the user a concise question with optional choices.",
  remember: "Save a useful fact or preference as a memory.",
  upsert_entity: "Create or update a person, project, tool, or other entity.",
  save_workflow: "Create or update a workflow in the knowledge graph.",
  today: "Read what needs attention, suggested automations, and recent chats; open the Today card.",
} as const;

export function toolPromptSection(): string {
  return Object.entries(AGENT_TOOL_DESCRIPTIONS)
    .map(([name, description]) => `- ${name}: ${description}`)
    .join("\n");
}

export interface AgentToolCtx {
  snapshot: CanvasSnapshot;
  userId?: string | null;
  emit: (event: AgentEvent) => void;
}

export function createToolCtx(
  snapshot: CanvasSnapshot,
  send: (event: AgentEvent) => void,
  userId?: string | null,
): AgentToolCtx {
  const ctx: AgentToolCtx = {
    snapshot,
    userId,
    emit: (event) => {
      const action = canvasActionForEvent(event);
      if (action) ctx.snapshot = applyCanvasToSnapshot(ctx.snapshot, action);
      send(event);
    },
  };
  return ctx;
}

function tracked<T>(
  ctx: AgentToolCtx,
  name: string,
  args: Record<string, unknown>,
  execute: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  ctx.emit({ type: "agent.tool.start", name, args });
  return execute()
    .then((result) => {
      ctx.emit({ type: "agent.tool.done", name, ok: true });
      return { ok: true as const, result };
    })
    .catch((error: unknown) => {
      ctx.emit({ type: "agent.tool.done", name, ok: false });
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function integrationNeighbors(focus: string, userId?: string | null) {
  const [user, integrations, entities, memories, skills, workflows] =
    await Promise.all([
      getKgUser(userId).catch(() => null),
      getKgIntegrations(userId).catch(() => []),
      getKgEntities(undefined, userId).catch(() => []),
      getKgMemories({ by: "confidence", limit: 30 }, userId).catch(() => []),
      getKgSkills({ minStrength: 1 }, userId).catch(() => []),
      getKgWorkflows(userId).catch(() => []),
    ]);
  const graph = toGraph({
    user,
    integrations,
    entities,
    memories,
    skills,
    workflows,
    connections: [],
  });
  const focusId = resolveNodeRef(graph.nodes, focus);
  if (!focusId) return [];
  const adjacency = buildAdjacency(graph.links);
  const layerOrder = ["integration", "entity", "skill", "workflow", "memory"];
  return [...(adjacency.get(focusId) ?? [])]
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter((node) => node && node.layer !== "user")
    .sort((a, b) =>
      layerOrder.indexOf(a!.layer) - layerOrder.indexOf(b!.layer) ||
      a!.label.localeCompare(b!.label),
    )
    .map((node) => node!.label);
}

export function createAgentTools(ctx: AgentToolCtx) {
  return {
    show: tool({
      description: AGENT_TOOL_DESCRIPTIONS.show,
      inputSchema: z.object({
        kind: SHOW_KIND,
        focus: z.string().optional().describe("node, entity, or workflow to focus"),
      }),
      execute: async ({ kind, focus }) => {
        const neighbors =
          kind === "graph" && focus
            ? await integrationNeighbors(focus, ctx.userId)
            : undefined;
        ctx.emit({
          type: "ui.canvas",
          action: {
            type: "open",
            kind,
            ...(focus ? { payload: { focus } } : {}),
            openedBy: "agent",
          },
        });
        return {
          ok: true,
          kind,
          ...(focus ? { focus } : {}),
          ...(neighbors ? { neighbors } : {}),
        };
      },
    }),

    close: tool({
      description: AGENT_TOOL_DESCRIPTIONS.close,
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.snapshot.open) return { ok: false, reason: "nothing open" };
        ctx.emit({ type: "ui.canvas", action: { type: "close" } });
        return { ok: true };
      },
    }),

    search: tool({
      description: AGENT_TOOL_DESCRIPTIONS.search,
      inputSchema: z.object({
        query: z.string().min(1),
        scope: z.enum(["memories", "entities", "workflows", "all"]).optional().default("all"),
      }),
      execute: async ({ query, scope }) => {
        const result = await tracked(ctx, "search", { query, scope }, () =>
          searchKg(query, scope, ctx.userId),
        );
        if (result.ok && result.result.results.length > 0) {
          const top = result.result.results[0];
          const cardKind =
            top.kind === "entities" ? "entity_detail" : top.kind;
          const cardResults = top.kind === "memories"
            ? result.result.results.filter((item) => item.kind === "memories")
            : result.result.results;
          ctx.emit({
            type: "ui.tool.open",
            kind: cardKind,
            payload: {
              query,
              scope,
              count: cardResults.length,
              results: cardResults,
              focus: top.focus,
              status: "done",
            },
          });
        }
        return result;
      },
    }),

    today: tool({
      description: AGENT_TOOL_DESCRIPTIONS.today,
      inputSchema: z.object({
        focus: z.enum(["needs_you", "suggestions"]).optional(),
      }),
      execute: async ({ focus }) => {
        const result = await tracked(ctx, "today", focus ? { focus } : {}, () =>
          getToday(ctx.userId),
        );
        if (result.ok) {
          ctx.emit({
            type: "ui.tool.open",
            kind: "today",
            payload: { ...result.result, ...(focus ? { focus } : {}) },
          });
        }
        return result;
      },
    }),

    ask_user: tool({
      description: AGENT_TOOL_DESCRIPTIONS.ask_user,
      inputSchema: z.object({
        question: z.string().min(1),
        options: z.array(z.string()).max(4).optional(),
      }),
      execute: async ({ question, options }) => {
        ctx.emit({
          type: "ui.ask",
          question,
          options: options ?? [],
        });
        return { ok: true, question, options: options ?? [] };
      },
    }),

    remember: tool({
      description: AGENT_TOOL_DESCRIPTIONS.remember,
      inputSchema: z.object({
        text: z.string().min(1),
        about: z.string().optional().describe("optional entity record id or integration slug"),
      }),
      execute: async ({ text, about }) => {
        const result = await tracked(ctx, "remember", { text, about }, () =>
          addMemory({
            content: text,
            ...(about
              ? about.includes(":")
                ? { about_entity_id: about }
                : { about_integration_slug: about }
              : {}),
          }, ctx.userId),
        );
        if (result.ok) {
          ctx.emit({
            type: "ui.tool.open",
            kind: "memories",
            payload: {
              query: text,
              scope: "memories",
              count: 1,
              results: [{
                kind: "memories",
                id: result.result.id,
                snippet: text,
                score: 1,
              }],
              status: "done",
            },
          });
        }
        return result;
      },
    }),

    upsert_entity: tool({
      description: AGENT_TOOL_DESCRIPTIONS.upsert_entity,
      inputSchema: z.object({
        name: z.string().min(1),
        entity_type: z.string().min(1),
        description: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        appears_in_integration: z.string().optional(),
        appears_in_handle: z.string().optional(),
        appears_in_role: z.string().optional(),
      }),
      execute: async (args) => {
        const result = await tracked(ctx, "upsert_entity", args, () =>
          upsertEntity(args, ctx.userId),
        );
        if (result.ok) {
          ctx.emit({
            type: "ui.tool.open",
            kind: "entities",
            payload: { ...args, ...result.result, status: "done" },
          });
        }
        return result;
      },
    }),

    save_workflow: tool({
      description: AGENT_TOOL_DESCRIPTIONS.save_workflow,
      inputSchema: z.object({
        slug: z.string().optional(),
        name: z.string().min(1),
        description: z.string().min(1),
        trigger: z.string().optional(),
        outcome: z.string().optional(),
        frequency: z.string().optional(),
        tags: z.array(z.string()).optional(),
        skill_chain: z.array(z.object({
          slug: z.string(),
          step_order: z.number().int().nonnegative(),
        })).optional(),
      }),
      execute: async ({ slug, ...workflow }) => {
        const input = { slug: slug || slugify(workflow.name), ...workflow };
        const result = await tracked(ctx, "save_workflow", input, () =>
          upsertWorkflow(input, ctx.userId),
        );
        if (result.ok) {
          ctx.emit({
            type: "ui.tool.open",
            kind: "workflows",
            payload: { ...input, ...result.result, focus: input.slug, status: "done" },
          });
        }
        return result;
      },
    }),
  };
}
