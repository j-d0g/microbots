/**
 * Conversation types for the ElevenLabs Conversational Agent
 *
 * These types support fast voice-to-voice conversation with intent summarization.
 * The ElevenLabs agent works alongside the UI agent (orchestrator) - it handles
 * conversational thinking and fast responses while the UI agent handles navigation.
 */

import type { WindowKind } from "@/lib/store";

/**
 * Intent action types extracted from user utterances
 */
export type IntentAction =
  | "navigate"   // Open/focus a specific window/view
  | "query"      // Ask for information
  | "create"     // Create new entity/memory/skill/workflow
  | "update"     // Update existing data
  | "delete"     // Remove something
  | "chat"       // General conversation
  | "confirm"    // Confirm an action
  | "cancel"     // Cancel/reject an action
  | "interrupt"; // User interrupted agent

/**
 * Summary of user intent extracted from each utterance
 * Emitted to the store so the UI agent can act on it
 */
export interface IntentSummary {
  /** Classified action type */
  action: IntentAction;
  /** Target entity type (e.g., "graph", "chat", "entities", "memory") */
  target?: string;
  /** Specific entity ID if mentioned */
  entityId?: string;
  /** Additional parameters extracted from utterance */
  parameters?: Record<string, unknown>;
  /** Confidence score 0-1 */
  confidence: number;
  /** Raw transcript that produced this intent */
  rawTranscript: string;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * A single turn in the conversation (user or agent)
 */
export interface ConversationTurn {
  id: string;
  role: "user" | "agent" | "system";
  /** Text content (transcript for user, response for agent) */
  text: string;
  /** Timestamp in ms */
  timestamp: number;
  /** Intent extracted from this turn (user turns only) */
  intent?: IntentSummary;
  /** Whether this turn was handled via fast path (no LLM call) */
  fastPath?: boolean;
  /** Duration of response generation in ms */
  latencyMs?: number;
  /** Associated window/room context */
  room?: WindowKind;
}

/**
 * Conversation state stored in the agent store
 */
export interface ConversationState {
  /** Last 10 turns for context window */
  history: ConversationTurn[];
  /** Current intent being processed */
  currentIntent: IntentSummary | null;
  /** Whether conversation is active */
  isActive: boolean;
  /** Current turn ID counter */
  turnCounter: number;
  /** Session start time */
  sessionStartedAt: number | null;
  /** Last activity timestamp */
  lastActivityAt: number | null;
}

/**
 * Fast path response for common intents
 * Pre-computed responses that bypass full LLM calls
 */
export interface FastPathResponse {
  /** Pattern to match against transcript */
  pattern: RegExp;
  /** Action type this pattern matches */
  action: IntentAction;
  /** Target window/entity */
  target?: string;
  /** Response text to speak */
  responseText: string;
  /** Optional UI events to emit */
  uiEvents?: Array<{
    type: "ui.room" | "ui.tool" | "ui.verb";
    payload: Record<string, unknown>;
  }>;
}

/**
 * ElevenLabs Conversational AI API types
 */
export interface ElevenLabsConversationConfig {
  /** Agent ID from ElevenLabs dashboard */
  agentId: string;
  /** API key (server-side only) */
  apiKey?: string;
  /** Voice settings */
  voice?: {
    voiceId?: string;
    stability?: number;
    similarityBoost?: number;
  };
  /** Conversation settings */
  conversation?: {
    /** Max turns to keep in context */
    maxHistoryTurns?: number;
    /** Enable automatic interruption handling */
    allowInterruptions?: boolean;
  };
}

/**
 * WebSocket message types for ElevenLabs Conversational AI
 */
export type ElevenLabsMessageType =
  | "user_transcript"      // STT result from user audio
  | "agent_response"       // LLM text response
  | "audio"                // Audio chunk from agent
  | "interruption"         // User interrupted agent
  | "conversation_turn"    // Turn completion signal
  | "ping"                 // Keepalive
  | "error";               // Error from API

/**
 * WebSocket message from ElevenLabs
 */
export interface ElevenLabsMessage {
  type: ElevenLabsMessageType;
  /** For user_transcript: the transcript */
  text?: string;
  /** For audio: base64 encoded audio data */
  audio?: string;
  /** For agent_response: the response text */
  response?: string;
  /** Whether this is the final chunk */
  isFinal?: boolean;
  /** Error message */
  error?: string;
  /** Turn ID */
  turnId?: string;
}

/**
 * Conversation event emitted by the ElevenLabs agent
 * These flow to the UI via the store
 */
export type ConversationEvent =
  | { type: "conversation.start"; timestamp: number }
  | { type: "conversation.turn.start"; turnId: string; role: "user" | "agent" }
  | { type: "conversation.turn.end"; turnId: string; role: "user" | "agent"; intent?: IntentSummary }
  | { type: "conversation.transcript"; text: string; isFinal: boolean }
  | { type: "conversation.response"; text: string; isFinal: boolean }
  | { type: "conversation.intent"; intent: IntentSummary }
  | { type: "conversation.audio"; audioBase64: string }
  | { type: "conversation.interruption"; timestamp: number }
  | { type: "conversation.error"; error: string }
  | { type: "conversation.end"; timestamp: number };

/**
 * Initial conversation state factory
 */
export function createInitialConversationState(): ConversationState {
  return {
    history: [],
    currentIntent: null,
    isActive: false,
    turnCounter: 0,
    sessionStartedAt: null,
    lastActivityAt: null,
  };
}

/**
 * Maximum turns to keep in conversation history
 * Keeps context window bounded for LLM calls
 */
export const MAX_CONVERSATION_HISTORY = 10;

/**
 * Navigation intent patterns for fast-path detection
 * These patterns map common utterances to window navigation
 */
export const NAVIGATION_PATTERNS: FastPathResponse[] = [
  {
    pattern: /\b(open|show|go to|switch to|view)\s+(the\s+)?graph\b/i,
    action: "navigate",
    target: "graph",
    responseText: "here's your knowledge graph.",
    uiEvents: [{ type: "ui.room", payload: { room: "graph" } }],
  },
  {
    pattern: /\b(open|show|go to|view)\s+(the\s+)?chat\b/i,
    action: "navigate",
    target: "chat",
    responseText: "opening chat.",
    uiEvents: [{ type: "ui.room", payload: { room: "chat" } }],
  },
  {
    pattern: /\b(show|view)\s+(my\s+)?(entities|items|things)\b/i,
    action: "navigate",
    target: "entities",
    responseText: "showing your entities.",
    uiEvents: [{ type: "ui.room", payload: { room: "entities" } }],
  },
  {
    pattern: /\b(show|view)\s+(my\s+)?(memories|notes|remembered)\b/i,
    action: "navigate",
    target: "memories",
    responseText: "here are your memories.",
    uiEvents: [{ type: "ui.room", payload: { room: "memories" } }],
  },
  {
    pattern: /\b(show|view)\s+(my\s+)?(skills|abilities)\b/i,
    action: "navigate",
    target: "skills",
    responseText: "showing your skills.",
    uiEvents: [{ type: "ui.room", payload: { room: "skills" } }],
  },
  {
    pattern: /\b(show|view)\s+(my\s+)?(workflows|processes)\b/i,
    action: "navigate",
    target: "workflows",
    responseText: "here are your workflows.",
    uiEvents: [{ type: "ui.room", payload: { room: "workflows" } }],
  },
  {
    pattern: /\b(show|view)\s+(my\s+)?(profile|account)\b/i,
    action: "navigate",
    target: "profile",
    responseText: "here's your profile.",
    uiEvents: [{ type: "ui.room", payload: { room: "profile" } }],
  },
  {
    pattern: /\b(show|view)\s+(the\s+)?(integrations|connections|apps)\b/i,
    action: "navigate",
    target: "integrations",
    responseText: "showing your integrations.",
    uiEvents: [{ type: "ui.room", payload: { room: "integrations" } }],
  },
  {
    pattern: /\b(show|view)\s+(the\s+)?(wiki|docs|documentation)\b/i,
    action: "navigate",
    target: "wiki",
    responseText: "opening the wiki.",
    uiEvents: [{ type: "ui.room", payload: { room: "wiki" } }],
  },
  {
    pattern: /\b(open|show)\s+settings\b/i,
    action: "navigate",
    target: "settings",
    responseText: "opening settings.",
    uiEvents: [{ type: "ui.room", payload: { room: "settings" } }],
  },
  {
    pattern: /\b(clear|clean|reset)\s+(the\s+)?(canvas|everything|all)\b/i,
    action: "navigate",
    target: "clear",
    responseText: "clearing the canvas.",
    uiEvents: [{ type: "ui.tool", payload: { tool: "clear_canvas" } }],
  },
  {
    pattern: /\b(close|hide)\s+(this\s+)?window\b/i,
    action: "navigate",
    target: "close",
    responseText: "closing the window.",
    uiEvents: [{ type: "ui.tool", payload: { tool: "close_window" } }],
  },
  // Confirmation patterns
  {
    pattern: /\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it)\b/i,
    action: "confirm",
    target: "current",
    responseText: "confirmed.",
  },
  // Cancellation patterns
  {
    pattern: /\b(no|nope|nah|cancel|stop|never mind|nevermind)\b/i,
    action: "cancel",
    target: "current",
    responseText: "canceled.",
  },
];

/**
 * Greeting patterns for fast-path responses
 */
export const GREETING_PATTERNS: FastPathResponse[] = [
  {
    pattern: /\b(hello|hi|hey|morning|afternoon|evening|good morning|good afternoon|good evening)\b/i,
    action: "chat",
    responseText: "hey there. what can i help you with?",
  },
  {
    pattern: /\b(what's up|sup|how are you|how's it going)\b/i,
    action: "chat",
    responseText: "i'm good. ready to help. what's on your mind?",
  },
  {
    pattern: /\b(thanks|thank you|appreciate it)\b/i,
    action: "chat",
    responseText: "you got it.",
  },
];

/**
 * All fast-path patterns combined
 */
export const ALL_FAST_PATH_PATTERNS: FastPathResponse[] = [
  ...NAVIGATION_PATTERNS,
  ...GREETING_PATTERNS,
];
