/**
 * Intent Parser for ElevenLabs Conversational Agent
 *
 * Extracts structured intent summaries from user utterances.
 * Uses fast-path pattern matching for common intents, falls back to
 * lightweight LLM classification for complex queries.
 */

import type {
  IntentSummary,
  IntentAction,
  FastPathResponse,
  ConversationTurn,
} from "./conversation-types";
import { ALL_FAST_PATH_PATTERNS, MAX_CONVERSATION_HISTORY } from "./conversation-types";

/**
 * Result of intent parsing
 */
export interface ParseResult {
  intent: IntentSummary;
  /** Whether this was matched via fast path */
  isFastPath: boolean;
  /** Matched pattern if fast path */
  matchedPattern?: FastPathResponse;
}

/**
 * Check if a transcript matches any fast-path pattern
 */
export function matchFastPath(transcript: string): FastPathResponse | null {
  const normalized = transcript.toLowerCase().trim();

  for (const pattern of ALL_FAST_PATH_PATTERNS) {
    if (pattern.pattern.test(normalized)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Parse intent from user transcript
 * Uses fast-path patterns first, returns structured intent summary
 */
export function parseIntent(
  transcript: string,
  opts?: {
    previousIntent?: IntentSummary | null;
    conversationHistory?: ConversationTurn[];
  }
): ParseResult {
  // Try fast-path first
  const fastPath = matchFastPath(transcript);
  if (fastPath) {
    const intent: IntentSummary = {
      action: fastPath.action,
      target: fastPath.target,
      parameters: extractParameters(transcript, fastPath),
      confidence: 0.95, // High confidence for pattern matches
      rawTranscript: transcript,
      timestamp: new Date().toISOString(),
    };

    return {
      intent,
      isFastPath: true,
      matchedPattern: fastPath,
    };
  }

  // Fall back to rule-based classification
  const intent = classifyWithRules(transcript, opts);

  return {
    intent,
    isFastPath: false,
  };
}

/**
 * Extract parameters from transcript based on matched pattern
 */
function extractParameters(
  transcript: string,
  pattern: FastPathResponse
): Record<string, unknown> | undefined {
  const params: Record<string, unknown> = {};

  // Extract entity mentions (e.g., "show me entity ABC-123")
  const entityMatch = transcript.match(/\b(entity|item|node)\s+([a-zA-Z0-9_-]+)\b/i);
  if (entityMatch) {
    params.entityId = entityMatch[2];
  }

  // Extract search queries (e.g., "find something about ...")
  const searchMatch = transcript.match(/\b(find|search|look for)\s+(?:something\s+)?(?:about\s+)?(.+?)(?:\s+(?:in|on|at)\s|$)/i);
  if (searchMatch) {
    params.query = searchMatch[2].trim();
  }

  // Extract memory/skill/workflow names
  const nameMatch = transcript.match(/\b(?:called|named)\s+["']?([^"']+)["']?/i);
  if (nameMatch) {
    params.name = nameMatch[1];
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Rule-based intent classification for non-fast-path utterances
 */
function classifyWithRules(
  transcript: string,
  opts?: {
    previousIntent?: IntentSummary | null;
    conversationHistory?: ConversationTurn[];
  }
): IntentSummary {
  const normalized = transcript.toLowerCase().trim();

  // Query patterns
  if (/\b(what|who|when|where|why|how|is|are|does|do|can|could|would)\b/i.test(normalized)) {
    return buildIntent("query", transcript, 0.85);
  }

  // Create patterns
  if (/\b(create|make|add|new|save|record|write|note)\b/i.test(normalized)) {
    const target = extractCreateTarget(normalized);
    return buildIntent("create", transcript, 0.8, target);
  }

  // Update patterns
  if (/\b(update|change|modify|edit|set|configure)\b/i.test(normalized)) {
    return buildIntent("update", transcript, 0.75);
  }

  // Delete patterns
  if (/\b(delete|remove|erase|clear|get rid of)\b/i.test(normalized)) {
    return buildIntent("delete", transcript, 0.7);
  }

  // Interrupt detection
  if (/\b(wait|stop|hold on|pause|interrupt)\b/i.test(normalized)) {
    return buildIntent("interrupt", transcript, 0.9);
  }

  // Check for follow-up context from previous intent
  if (opts?.previousIntent) {
    const followUpIntent = classifyFollowUp(normalized, opts.previousIntent, opts.conversationHistory);
    if (followUpIntent) {
      return followUpIntent;
    }
  }

  // Default to chat
  return buildIntent("chat", transcript, 0.6);
}

/**
 * Extract target type from create commands
 */
function extractCreateTarget(transcript: string): string | undefined {
  if (/\b(memory|note|remember)\b/i.test(transcript)) return "memory";
  if (/\b(entity|item|thing|person|project|team)\b/i.test(transcript)) return "entity";
  if (/\b(skill|ability|capability)\b/i.test(transcript)) return "skill";
  if (/\b(workflow|process|automation|routine)\b/i.test(transcript)) return "workflow";
  if (/\b(wiki|page|doc|document)\b/i.test(transcript)) return "wiki";
  if (/\b(chat|message|conversation)\b/i.test(transcript)) return "chat";
  return undefined;
}

/**
 * Classify follow-up utterances based on conversation context
 */
function classifyFollowUp(
  transcript: string,
  previousIntent: IntentSummary,
  history?: ConversationTurn[]
): IntentSummary | null {
  // Short responses to questions often indicate confirm/cancel
  if (transcript.length < 10) {
    if (/\b(yes|yeah|yep|sure|ok|okay|right|correct)\b/i.test(transcript)) {
      return buildIntent("confirm", transcript, 0.85, previousIntent.target);
    }
    if (/\b(no|nope|nah|wrong|incorrect)\b/i.test(transcript)) {
      return buildIntent("cancel", transcript, 0.85, previousIntent.target);
    }
  }

  // "The one about..." - referencing previous query
  if (/\b(the one|that|it|this)\s+(about|regarding|concerning|for)\b/i.test(transcript)) {
    // Inherit action from previous but keep new transcript
    return buildIntent(previousIntent.action, transcript, 0.75, previousIntent.target);
  }

  return null;
}

/**
 * Build an intent summary
 */
function buildIntent(
  action: IntentAction,
  transcript: string,
  confidence: number,
  target?: string,
  entityId?: string,
  parameters?: Record<string, unknown>
): IntentSummary {
  return {
    action,
    target,
    entityId,
    parameters,
    confidence,
    rawTranscript: transcript,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build conversation context string for LLM prompts
 * Uses last N turns to keep within token limits
 */
export function buildConversationContext(
  history: ConversationTurn[],
  maxTurns: number = MAX_CONVERSATION_HISTORY
): string {
  const relevantHistory = history.slice(-maxTurns);

  return relevantHistory
    .map((turn) => {
      const role = turn.role === "user" ? "User" : "Agent";
      return `${role}: ${turn.text}`;
    })
    .join("\n");
}

/**
 * Format intent for debug/logging
 */
export function formatIntent(intent: IntentSummary): string {
  const parts = [`[${intent.action}]`];
  if (intent.target) parts.push(`target:${intent.target}`);
  if (intent.entityId) parts.push(`entity:${intent.entityId}`);
  parts.push(`${Math.round(intent.confidence * 100)}%`);
  return parts.join(" ");
}

/**
 * Check if intent is high-confidence enough to act on
 */
export function isConfident(intent: IntentSummary, threshold: number = 0.7): boolean {
  return intent.confidence >= threshold;
}
