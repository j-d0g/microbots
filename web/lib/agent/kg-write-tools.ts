/**
 * KG write tools — the 7 knowledge-graph mutation tools declared in the
 * orchestrator's system prompt under WRITES.
 *
 * Each tool calls the corresponding backend REST API via the typed
 * helpers in `backend.ts`, emits a `ui.tool.open` event so the relevant
 * window updates in the browser, and records the action in the
 * server-side snapshot via `applyAndEmit`.
 */

import { tool } from "ai";
import { z } from "zod";
import { applyToolToSnapshot } from "./server-snapshot";
import {
  addMemory,
  upsertEntity,
  upsertSkill,
  upsertWorkflow,
  addChat,
  writeWikiPage,
  updateUser,
} from "../api/backend";
import type { AgentToolCtx } from "./tools";
import type { AgentEvent } from "../agent-client";
import type { WindowKind } from "../store";

/* ------------------------------------------------------------------ *
 *  Shared helper — mirrors the pattern from tools.ts
 * ------------------------------------------------------------------ */

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
 *  KG write tool definitions
 * ------------------------------------------------------------------ */

export function kgWriteTools(ctx: AgentToolCtx) {
  return {
    add_memory: tool({
      description:
        "Persist a memory to the knowledge graph. Use when the user says 'remember X', 'note that X', or you observe something worth retaining.",
      inputSchema: z.object({
        content: z.string().min(1),
        memory_type: z
          .enum(["fact", "preference", "action_pattern", "decision", "observation"])
          .optional(),
        confidence: z.number().min(0).max(1).optional(),
        source: z.string().optional(),
        tags: z.array(z.string()).optional(),
        chat_id: z.string().optional(),
        about_entity_id: z.string().optional(),
        about_integration_slug: z.string().optional(),
      }),
      execute: async (args) => {
        try {
          const result = await addMemory(args);
          const payload = { ...args, ...result, status: "done" };
          const events: AgentEvent[] = [
            { type: "ui.tool.open", kind: "memories" as WindowKind, payload },
          ];
          return applyAndEmit(ctx, "add_memory", args, events);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "add_memory", args });
          ctx.emit({ type: "agent.tool.done", name: "add_memory", ok: false });
          return `Failed to add memory: ${msg}`;
        }
      },
    }),

    upsert_entity: tool({
      description:
        "Create or update an entity in the knowledge graph. Use for people, projects, tools, concepts — anything the user references that deserves a node.",
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
        try {
          const result = await upsertEntity(args);
          const payload = { ...args, ...result, status: "done" };
          const events: AgentEvent[] = [
            { type: "ui.tool.open", kind: "entities" as WindowKind, payload },
          ];
          return applyAndEmit(ctx, "upsert_entity", args, events);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "upsert_entity", args });
          ctx.emit({ type: "agent.tool.done", name: "upsert_entity", ok: false });
          return `Failed to upsert entity: ${msg}`;
        }
      },
    }),

    upsert_skill: tool({
      description:
        "Create or update a skill in the knowledge graph. Skills represent recurring capabilities the user has or wants to develop.",
      inputSchema: z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        steps: z.array(z.string()).optional(),
        frequency: z.string().optional(),
        strength_increment: z.number().min(1).max(10).optional(),
        tags: z.array(z.string()).optional(),
        uses_integrations: z.array(z.string()).optional(),
      }),
      execute: async (args) => {
        try {
          const result = await upsertSkill(args);
          const payload = { ...args, ...result, status: "done" };
          const events: AgentEvent[] = [
            { type: "ui.tool.open", kind: "skills" as WindowKind, payload },
          ];
          return applyAndEmit(ctx, "upsert_skill", args, events);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "upsert_skill", args });
          ctx.emit({ type: "agent.tool.done", name: "upsert_skill", ok: false });
          return `Failed to upsert skill: ${msg}`;
        }
      },
    }),

    upsert_workflow: tool({
      description:
        "Create or update a workflow in the knowledge graph. Workflows chain skills together with a trigger and outcome.",
      inputSchema: z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        trigger: z.string().optional(),
        outcome: z.string().optional(),
        frequency: z.string().optional(),
        tags: z.array(z.string()).optional(),
        skill_chain: z
          .array(
            z.object({
              slug: z.string(),
              step_order: z.number(),
            }),
          )
          .optional(),
      }),
      execute: async (args) => {
        try {
          const result = await upsertWorkflow(args);
          const payload = { ...args, ...result, status: "done" };
          const events: AgentEvent[] = [
            { type: "ui.tool.open", kind: "workflows" as WindowKind, payload },
          ];
          return applyAndEmit(ctx, "upsert_workflow", args, events);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "upsert_workflow", args });
          ctx.emit({ type: "agent.tool.done", name: "upsert_workflow", ok: false });
          return `Failed to upsert workflow: ${msg}`;
        }
      },
    }),

    add_chat: tool({
      description:
        "Persist a chat message or conversation snippet to the knowledge graph. Use to log important exchanges from integrations or the user.",
      inputSchema: z.object({
        content: z.string().min(1),
        source_type: z.string().min(1),
        source_id: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        signal_level: z.enum(["low", "mid", "high"]).optional(),
        occurred_at: z.string().optional(),
        from_integration: z.string().optional(),
        mentions: z
          .array(
            z.object({
              id: z.string(),
              mention_type: z.string().optional(),
            }),
          )
          .optional(),
      }),
      execute: async (args) => {
        try {
          const result = await addChat(args as Parameters<typeof addChat>[0]);
          const payload = { ...args, ...result, status: "done" };
          const events: AgentEvent[] = [
            { type: "ui.tool.open", kind: "chats_summary" as WindowKind, payload },
          ];
          return applyAndEmit(ctx, "add_chat", args, events);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "add_chat", args });
          ctx.emit({ type: "agent.tool.done", name: "add_chat", ok: false });
          return `Failed to add chat: ${msg}`;
        }
      },
    }),

    write_wiki_page: tool({
      description:
        "Create or overwrite a wiki page in the knowledge graph. Use for documentation, notes, and structured knowledge.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string().min(1),
        rationale: z.string().optional(),
      }),
      execute: async ({ path, content, rationale }) => {
        const args = { path, content, rationale };
        try {
          const result = await writeWikiPage(path, { content, rationale });
          const payload = { ...args, ...result, status: "done" };
          const events: AgentEvent[] = [
            { type: "ui.tool.open", kind: "wiki" as WindowKind, payload },
          ];
          return applyAndEmit(ctx, "write_wiki_page", args, events);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "write_wiki_page", args });
          ctx.emit({ type: "agent.tool.done", name: "write_wiki_page", ok: false });
          return `Failed to write wiki page: ${msg}`;
        }
      },
    }),

    update_user: tool({
      description:
        "Update the user's profile — name, role, goals, preferences, or context window size.",
      inputSchema: z.object({
        name: z.string().optional(),
        role: z.string().optional(),
        goals: z.array(z.string()).optional(),
        preferences: z.record(z.string(), z.unknown()).optional(),
        context_window: z.number().optional(),
      }),
      execute: async (args) => {
        try {
          const result = await updateUser(args);
          const payload = { ...args, ...result, status: "done" };
          const events: AgentEvent[] = [
            { type: "ui.tool.open", kind: "profile" as WindowKind, payload },
          ];
          return applyAndEmit(ctx, "update_user", args, events);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.emit({ type: "agent.tool.start", name: "update_user", args });
          ctx.emit({ type: "agent.tool.done", name: "update_user", ok: false });
          return `Failed to update user: ${msg}`;
        }
      },
    }),
  };
}

export type KgWriteToolBag = ReturnType<typeof kgWriteTools>;
