"use client";

/**
 * Intent Router for ElevenLabs Agent
 *
 * Routes intent summaries from the ElevenLabs conversational agent
 * to appropriate UI actions via the existing window-tools system.
 *
 * Intent Types:
 * - navigate: Open windows, change rooms
 * - query: Execute queries, show results
 * - create/update/delete: Stage confirmation via confirmQueue
 * - confirm/cancel: Resolve confirmation gates
 * - chat: Pure conversational response (no UI action)
 */

import { useAgentStore, type WindowKind, type RoomKind } from "./store";
import { applyAgentEvent, type AgentEvent } from "./agent-client";
import { requestSpeak } from "./voice-coordination";

export type IntentType =
  | "navigate"
  | "query"
  | "create"
  | "update"
  | "delete"
  | "confirm"
  | "cancel"
  | "chat";

export interface IntentSummary {
  type: IntentType;
  target?: WindowKind | string;
  query?: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  confirmationId?: string;
  approved?: boolean;
  /** Natural language response from ElevenLabs */
  responseText?: string;
  /** Whether UI should speak the response (if ElevenLabs didn't) */
  shouldSpeak?: boolean;
}

/**
 * Route an intent summary to appropriate UI actions.
 * Returns true if a UI action was triggered.
 */
export async function routeIntentSummary(intent: IntentSummary): Promise<boolean> {
  const store = useAgentStore.getState();

  // Always log intent for debugging
  console.log("[intent-router] Routing intent:", intent.type, intent);

  // Chat intent: no UI action needed
  if (intent.type === "chat") {
    if (intent.responseText && intent.shouldSpeak) {
      await requestSpeak(intent.responseText, "ui");
    }
    return false;
  }

  // Handle confirmation gates
  if (intent.type === "confirm" || intent.type === "cancel") {
    if (intent.confirmationId) {
      applyAgentEvent({
        type: "ui.confirm.resolved",
        id: intent.confirmationId,
        approved: intent.type === "confirm",
      });
      return true;
    }
  }

  // Navigate: open window/change room
  if (intent.type === "navigate" && intent.target) {
    const target = intent.target as WindowKind;
    applyAgentEvent({
      type: "ui.room",
      room: target,
      payload: intent.data,
    });
    return true;
  }

  // Query: execute and show results
  if (intent.type === "query" && intent.query) {
    // Open chat window with query results
    applyAgentEvent({
      type: "ui.room",
      room: "chat",
      payload: { query: intent.query, results: intent.data },
    });
    return true;
  }

  // Create/Update/Delete: stage confirmation
  if (
    (intent.type === "create" ||
      intent.type === "update" ||
      intent.type === "delete") &&
    intent.entityType
  ) {
    const confirmIntent = {
      id: `intent-${Date.now()}`,
      toolName: `${intent.type}_${intent.entityType}`,
      description: `${intent.type} ${intent.entityType}${
        intent.entityId ? ` ${intent.entityId}` : ""
      }`,
      stagedAt: Date.now(),
      args: intent.data ?? {},
    };

    applyAgentEvent({
      type: "ui.confirm",
      intent: confirmIntent,
    });

    // Optionally speak the confirmation request
    if (intent.responseText && intent.shouldSpeak) {
      await requestSpeak(intent.responseText, "ui");
    }

    return true;
  }

  // Unknown intent type
  console.warn("[intent-router] Unknown intent type:", intent.type);
  return false;
}

/**
 * Process an ElevenLabs response that contains both conversational text
 * and an intent summary. Handles the fast handoff pattern.
 */
export async function processElevenLabsResponse({
  responseText,
  intent,
}: {
  responseText?: string;
  intent?: IntentSummary;
}): Promise<void> {
  // Start TTS immediately for fast response
  const speakPromise = responseText
    ? requestSpeak(responseText, "elevenlabs")
    : Promise.resolve();

  // Route intent in parallel (UI actions happen while voice plays)
  const routePromise = intent ? routeIntentSummary(intent) : Promise.resolve(false);

  // Wait for both to complete
  await Promise.all([speakPromise, routePromise]);
}

/**
 * Hook for components to use intent routing.
 */
export function useIntentRouter() {
  return {
    routeIntentSummary,
    processElevenLabsResponse,
  };
}

/**
 * Map a natural language intent to a WindowKind.
 * Used for fuzzy matching when the LLM doesn't return exact kinds.
 */
export function mapIntentToWindowKind(intent: string): WindowKind | null {
  const mappings: Record<string, WindowKind[]> = {
    chat: ["chat"],
    message: ["chat"],
    talk: ["chat"],
    entity: ["entities", "entity_detail"],
    person: ["entities", "entity_detail"],
    memory: ["memories"],
    remember: ["memories"],
    integration: ["integrations", "integration_detail"],
    connect: ["integrations", "integration_detail"],
    skill: ["skills"],
    workflow: ["workflows"],
    wiki: ["wiki"],
    knowledge: ["wiki"],
    setting: ["settings"],
    profile: ["profile"],
    graph: ["graph"],
    visualize: ["graph"],
    search: ["chats_summary"],
  };

  const lower = intent.toLowerCase();
  for (const [keyword, kinds] of Object.entries(mappings)) {
    if (lower.includes(keyword)) {
      return kinds[0];
    }
  }

  return null;
}
