/**
 * Window-tools barrel export.
 *
 * Every window kind in the app gets a dedicated tool bag that is
 * dynamically injected into the orchestrator depending on which window
 * is currently focused. This keeps the LLM context tight — only tools
 * relevant to the active window (+ global navigation tools) are
 * exposed in each turn.
 *
 * The exports are keyed by WindowKind so the orchestrator can do a
 * simple map lookup to pick the right bag.
 */

// Imports first (for factories table)
import { graphWindowTools } from "./graph";
import { askUserWindowTools } from "./ask-user";
import { integrationsWindowTools } from "./integrations";
import { integrationDetailWindowTools } from "./integration-detail";
import { entitiesWindowTools } from "./entities";
import { entityDetailWindowTools } from "./entity-detail";
import { memoriesWindowTools } from "./memories";
import { skillsWindowTools } from "./skills";
import { workflowsWindowTools } from "./workflows";

import type { AgentToolCtx } from "../tools";
import type { WindowKind } from "@/lib/store";

// Re-exports
export { graphWindowTools, type GraphWindowToolBag } from "./graph";
export { askUserWindowTools, type AskUserWindowToolBag } from "./ask-user";
export { integrationsWindowTools, type IntegrationsWindowToolBag } from "./integrations";
export { integrationDetailWindowTools, type IntegrationDetailWindowToolBag } from "./integration-detail";
export { entitiesWindowTools, type EntitiesWindowToolBag } from "./entities";
export { entityDetailWindowTools, type EntityDetailWindowToolBag } from "./entity-detail";
export { memoriesWindowTools, type MemoriesWindowToolBag } from "./memories";
export { skillsWindowTools, type SkillsWindowToolBag } from "./skills";
export { workflowsWindowTools, type WorkflowsWindowToolBag } from "./workflows";

/* ------------------------------------------------------------------ *
 *  Mapping table: WindowKind -> tool factory
 * ------------------------------------------------------------------ */

export type WindowToolFactory = (ctx: AgentToolCtx) => Record<string, unknown>;

export const WINDOW_TOOL_FACTORIES: Record<WindowKind, WindowToolFactory> = {
  graph: (ctx) => graphWindowTools(ctx),
  ask_user: (ctx) => askUserWindowTools(ctx),
  integrations: (ctx) => integrationsWindowTools(ctx),
  integration_detail: (ctx) => integrationDetailWindowTools(ctx),
  entities: (ctx) => entitiesWindowTools(ctx),
  entity_detail: (ctx) => entityDetailWindowTools(ctx),
  memories: (ctx) => memoriesWindowTools(ctx),
  skills: (ctx) => skillsWindowTools(ctx),
  workflows: (ctx) => workflowsWindowTools(ctx),
  // composio_connect reuses integrations tools — the connect manager
  // shares the same OAuth-centric tool bag.
  composio_connect: (ctx) => integrationsWindowTools(ctx),
};
