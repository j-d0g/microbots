/**
 * ElevenLabs Conversational Agent
 *
 * Handles fast voice-to-voice conversation with intent summarization.
 * Works alongside the UI agent (orchestrator) - this agent handles conversational
 * thinking and fast responses while the UI agent handles UI navigation.
 *
 * Key features:
 * - Real-time streaming audio responses
 * - Intent summarization after each user utterance
 * - Fast-path for common intents (pre-computed responses)
 * - Conversation history management (last 10 turns)
 * - Graceful interruption handling
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { speak, cancelSpeak } from "@/lib/voice";
import { sendQuery } from "@/lib/agent-client";
import type {
  IntentSummary,
  ConversationTurn,
  ConversationEvent,
  FastPathResponse,
  ElevenLabsConversationConfig,
} from "./conversation-types";
import {
  createInitialConversationState,
  MAX_CONVERSATION_HISTORY,
  ALL_FAST_PATH_PATTERNS,
} from "./conversation-types";
import { parseIntent, matchFastPath, isConfident } from "./intent-parser";
import type { WindowKind } from "@/lib/store";

/**
 * Connection state for the conversational agent
 */
export type ConversationalAgentState =
  | "idle"           // Not connected
  | "connecting"     // Establishing connection
  | "listening"      // Waiting for user input
  | "thinking"       // Processing intent/generating response
  | "speaking"       // Playing audio response
  | "interrupted";   // User interrupted, waiting

/**
 * Options for the ElevenLabs agent
 */
export interface ElevenLabsAgentOptions {
  /** Called when intent is extracted from user utterance */
  onIntent?: (intent: IntentSummary) => void;
  /** Called when agent state changes */
  onStateChange?: (state: ConversationalAgentState) => void;
  /** Called on conversation events */
  onEvent?: (event: ConversationEvent) => void;
  /** Enable fast path responses */
  enableFastPath?: boolean;
  /** Enable streaming responses */
  enableStreaming?: boolean;
  /** Minimum confidence threshold for auto-action */
  confidenceThreshold?: number;
  /** Auto-send intent to orchestrator for UI actions */
  autoSendToOrchestrator?: boolean;
}

/**
 * Hook for using the ElevenLabs Conversational Agent
 */
export function useElevenLabsAgent(opts: ElevenLabsAgentOptions = {}) {
  const {
    onIntent,
    onStateChange,
    onEvent,
    enableFastPath = true,
    enableStreaming = true,
    confidenceThreshold = 0.75,
    autoSendToOrchestrator = true,
  } = opts;

  const store = useAgentStore();

  // Local state refs
  const stateRef = useRef<ConversationalAgentState>("idle");
  const currentTurnRef = useRef<string | null>(null);
  const interruptRef = useRef(false);
  const audioQueueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  // Conversation state (mirrors store but for local use)
  const conversationStateRef = useRef(createInitialConversationState());

  // Update state helper
  const setState = useCallback((newState: ConversationalAgentState) => {
    if (stateRef.current !== newState) {
      stateRef.current = newState;
      onStateChange?.(newState);

      // Sync with store dock state
      const dockState = mapAgentStateToDock(newState);
      store.setDock(dockState);
    }
  }, [onStateChange, store]);

  // Map agent state to dock state
  const mapAgentStateToDock = (state: ConversationalAgentState) => {
    switch (state) {
      case "listening": return "listening" as const;
      case "thinking": return "thinking" as const;
      case "speaking": return "speaking" as const;
      default: return "idle" as const;
    }
  };

  /**
   * Handle user transcript (from STT)
   * This is the main entry point for processing user input
   */
  const handleTranscript = useCallback(async (transcript: string, isFinal: boolean) => {
    if (!isFinal || !transcript.trim()) return;

    const startTime = performance.now();

    // Parse intent from transcript
    const parseResult = parseIntent(transcript, {
      previousIntent: conversationStateRef.current.currentIntent,
      conversationHistory: conversationStateRef.current.history,
    });

    const { intent, isFastPath } = parseResult;

    // Update conversation state
    conversationStateRef.current.currentIntent = intent;

    // Emit intent event
    onIntent?.(intent);
    onEvent?.({ type: "conversation.intent", intent });

    // Create user turn
    const turnId = `turn-${++conversationStateRef.current.turnCounter}`;
    currentTurnRef.current = turnId;

    const userTurn: ConversationTurn = {
      id: `${turnId}-user`,
      role: "user",
      text: transcript,
      timestamp: Date.now(),
      intent,
      fastPath: isFastPath,
    };

    // Add to history
    addToHistory(userTurn);

    // Emit turn start
    onEvent?.({ type: "conversation.turn.start", turnId, role: "user" });

    // Handle fast-path responses immediately
    if (enableFastPath && isFastPath && parseResult.matchedPattern) {
      await handleFastPathResponse(transcript, parseResult.matchedPattern, intent, startTime);
      return;
    }

    // Handle via orchestrator for complex intents
    await handleOrchestratorResponse(transcript, intent, startTime);
  }, [enableFastPath, onIntent, onEvent, store]);

  /**
   * Handle fast-path response (no LLM call needed)
   */
  const handleFastPathResponse = async (
    transcript: string,
    pattern: FastPathResponse,
    intent: IntentSummary,
    startTime: number
  ) => {
    setState("speaking");

    // Emit UI events if any
    if (pattern.uiEvents) {
      for (const event of pattern.uiEvents) {
        if (event.type === "ui.room") {
          const room = event.payload.room as WindowKind;
          store.openWindow(room);
          store.setChatRoom(room);
        }
        // Other event types can be added here
      }
    }

    // Speak the fast response
    const stopSpeaking = await speak(pattern.responseText, {
      onStart: () => {
        onEvent?.({ type: "conversation.response", text: pattern.responseText, isFinal: false });
      },
      onEnd: () => {
        onEvent?.({ type: "conversation.response", text: pattern.responseText, isFinal: true });
      },
    });

    // Create agent turn
    const agentTurn: ConversationTurn = {
      id: `${currentTurnRef.current}-agent`,
      role: "agent",
      text: pattern.responseText,
      timestamp: Date.now(),
      fastPath: true,
      latencyMs: Math.round(performance.now() - startTime),
    };
    addToHistory(agentTurn);

    // Emit turn end
    onEvent?.({ type: "conversation.turn.end", turnId: currentTurnRef.current!, role: "agent", intent });

    setState("listening");
  };

  /**
   * Handle response via orchestrator (complex intents)
   */
  const handleOrchestratorResponse = async (
    transcript: string,
    intent: IntentSummary,
    startTime: number
  ) => {
    setState("thinking");

    // Check if we should auto-send to orchestrator
    if (autoSendToOrchestrator && isConfident(intent, confidenceThreshold)) {
      try {
        // Send to orchestrator with conversation context
        await sendQuery(transcript);

        // The orchestrator handles its own response streaming
        // We just track that we delegated

        const agentTurn: ConversationTurn = {
          id: `${currentTurnRef.current}-agent`,
          role: "agent",
          text: "[delegated to orchestrator]",
          timestamp: Date.now(),
          fastPath: false,
          latencyMs: Math.round(performance.now() - startTime),
        };
        addToHistory(agentTurn);

      } catch (err) {
        // Fallback to local response on orchestrator error
        console.warn("[elevenlabs-agent] orchestrator failed, using fallback", err);
        await speakFallbackResponse(intent);
      }
    } else {
      // Low confidence - use fallback response
      await speakFallbackResponse(intent);
    }

    onEvent?.({ type: "conversation.turn.end", turnId: currentTurnRef.current!, role: "agent", intent });
    setState("listening");
  };

  /**
   * Fallback response when orchestrator unavailable
   */
  const speakFallbackResponse = async (intent: IntentSummary) => {
    const responses: Record<string, string> = {
      navigate: "i'll take you there.",
      query: "let me look that up for you.",
      create: "i can help you create that.",
      update: "i'll update that for you.",
      delete: "i'll remove that for you.",
      chat: "tell me more.",
      confirm: "got it.",
      cancel: "no problem.",
      interrupt: "i'm here when you're ready.",
    };

    const responseText = responses[intent.action] || "i'm on it.";

    await speak(responseText, {
      onStart: () => {
        onEvent?.({ type: "conversation.response", text: responseText, isFinal: false });
      },
      onEnd: () => {
        onEvent?.({ type: "conversation.response", text: responseText, isFinal: true });
      },
    });
  };

  /**
   * Add turn to history, maintaining max size
   */
  const addToHistory = (turn: ConversationTurn) => {
    const state = conversationStateRef.current;
    state.history.push(turn);

    // Trim to max history
    if (state.history.length > MAX_CONVERSATION_HISTORY) {
      state.history = state.history.slice(-MAX_CONVERSATION_HISTORY);
    }

    // Update store conversation history
    store.setConversationHistory(state.history);
    store.setCurrentIntent(state.currentIntent);
  };

  /**
   * Handle interruption (user speaks while agent is speaking)
   */
  const handleInterruption = useCallback(() => {
    // Cancel current speech
    cancelSpeak();
    interruptRef.current = true;

    onEvent?.({ type: "conversation.interruption", timestamp: Date.now() });
    setState("interrupted");

    // Reset after brief delay
    setTimeout(() => {
      interruptRef.current = false;
      setState("listening");
    }, 100);
  }, [onEvent, setState]);

  /**
   * Start a new conversation session
   */
  const startSession = useCallback(() => {
    conversationStateRef.current = createInitialConversationState();
    conversationStateRef.current.sessionStartedAt = Date.now();
    conversationStateRef.current.isActive = true;

    onEvent?.({ type: "conversation.start", timestamp: Date.now() });
    setState("listening");
  }, [onEvent, setState]);

  /**
   * End the current conversation session
   */
  const endSession = useCallback(() => {
    cancelSpeak();
    conversationStateRef.current.isActive = false;

    onEvent?.({ type: "conversation.end", timestamp: Date.now() });
    setState("idle");
  }, [onEvent, setState]);

  /**
   * Get current conversation state
   */
  const getConversationState = useCallback(() => {
    return { ...conversationStateRef.current };
  }, []);

  /**
   * Clear conversation history
   */
  const clearHistory = useCallback(() => {
    conversationStateRef.current.history = [];
    conversationStateRef.current.currentIntent = null;
    store.setConversationHistory([]);
    store.setCurrentIntent(null);
  }, [store]);

  return {
    // State
    state: stateRef.current,
    isActive: conversationStateRef.current.isActive,

    // Actions
    handleTranscript,
    handleInterruption,
    startSession,
    endSession,
    getConversationState,
    clearHistory,

    // Fast path check (exposed for external use)
    checkFastPath: matchFastPath,
  };
}

/**
 * Standalone function to process a single utterance
 * Useful for non-hook contexts
 */
export async function processUtterance(
  transcript: string,
  opts?: {
    previousIntent?: IntentSummary | null;
    conversationHistory?: ConversationTurn[];
    onIntent?: (intent: IntentSummary) => void;
    enableFastPath?: boolean;
  }
): Promise<{ intent: IntentSummary; response?: string; isFastPath: boolean }> {
  const enableFastPath = opts?.enableFastPath ?? true;

  // Parse intent
  const parseResult = parseIntent(transcript, {
    previousIntent: opts?.previousIntent,
    conversationHistory: opts?.conversationHistory,
  });

  const { intent, isFastPath, matchedPattern } = parseResult;

  opts?.onIntent?.(intent);

  // Return fast-path response if matched
  if (enableFastPath && isFastPath && matchedPattern) {
    return {
      intent,
      response: matchedPattern.responseText,
      isFastPath: true,
    };
  }

  // Return intent only for orchestrator handling
  return {
    intent,
    isFastPath: false,
  };
}

/**
 * Check if an agent is available (has API key configured)
 */
export async function isElevenLabsAgentAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/voice/config");
    const config = await res.json();
    return config.stt === "elevenlabs" || config.tts === "elevenlabs";
  } catch {
    return false;
  }
}
