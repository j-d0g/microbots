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
import { chatWindowTools } from "./chat";
import { askUserWindowTools } from "./ask-user";
import { settingsWindowTools } from "./settings";
import { profileWindowTools } from "./profile";
import { integrationsWindowTools } from "./integrations";
import { integrationDetailWindowTools } from "./integration-detail";
import { entitiesWindowTools } from "./entities";
import { entityDetailWindowTools } from "./entity-detail";
import { memoriesWindowTools } from "./memories";
import { skillsWindowTools } from "./skills";
import { workflowsWindowTools } from "./workflows";
import { wikiWindowTools } from "./wiki";
import { chatsSummaryWindowTools } from "./chats-summary";
import { windowManagementTools } from "./window-management";

import type { AgentToolCtx } from "../tools";
import type { WindowKind } from "@/lib/store";

// Re-exports
export { graphWindowTools, type GraphWindowToolBag } from "./graph";
export { chatWindowTools, type ChatWindowToolBag } from "./chat";
export { askUserWindowTools, type AskUserWindowToolBag } from "./ask-user";
export { settingsWindowTools, type SettingsWindowToolBag } from "./settings";
export { profileWindowTools, type ProfileWindowToolBag } from "./profile";
export { integrationsWindowTools, type IntegrationsWindowToolBag } from "./integrations";
export { integrationDetailWindowTools, type IntegrationDetailWindowToolBag } from "./integration-detail";
export { entitiesWindowTools, type EntitiesWindowToolBag } from "./entities";
export { entityDetailWindowTools, type EntityDetailWindowToolBag } from "./entity-detail";
export { memoriesWindowTools, type MemoriesWindowToolBag } from "./memories";
export { skillsWindowTools, type SkillsWindowToolBag } from "./skills";
export { workflowsWindowTools, type WorkflowsWindowToolBag } from "./workflows";
export { wikiWindowTools, type WikiWindowToolBag } from "./wiki";
export { chatsSummaryWindowTools, type ChatsSummaryWindowToolBag } from "./chats-summary";
export { windowManagementTools, type WindowManagementToolBag } from "./window-management";

/* ------------------------------------------------------------------ *
 *  Mapping table: WindowKind -> tool factory
 * ------------------------------------------------------------------ */

export type WindowToolFactory = (ctx: AgentToolCtx) => Record<string, unknown>;

export const WINDOW_TOOL_FACTORIES: Record<WindowKind, WindowToolFactory> = {
  graph: (ctx) => graphWindowTools(ctx),
  chat: (ctx) => chatWindowTools(ctx),
  ask_user: (ctx) => askUserWindowTools(ctx),
  settings: (ctx) => settingsWindowTools(ctx),
  profile: (ctx) => profileWindowTools(ctx),
  integrations: (ctx) => integrationsWindowTools(ctx),
  integration_detail: (ctx) => integrationDetailWindowTools(ctx),
  entities: (ctx) => entitiesWindowTools(ctx),
  entity_detail: (ctx) => entityDetailWindowTools(ctx),
  memories: (ctx) => memoriesWindowTools(ctx),
  skills: (ctx) => skillsWindowTools(ctx),
  workflows: (ctx) => workflowsWindowTools(ctx),
  wiki: (ctx) => wikiWindowTools(ctx),
  chats_summary: (ctx) => chatsSummaryWindowTools(ctx),
  // composio_connect reuses integrations tools — the connect manager
  // shares the same OAuth-centric tool bag.
  composio_connect: (ctx) => integrationsWindowTools(ctx),
};
