"use client";

/**
 * Voice Coordination Layer
 *
 * Manages TTS coordination between ElevenLabs conversational agent and UI agent.
 * Prevents collision when both agents want to speak simultaneously.
 *
 * Architecture:
 * - ElevenLabs has priority for conversational responses
 * - UI agent TTS is queued when ElevenLabs is speaking
 * - User speech interrupts current TTS (both agents)
 * - Fast handoff: UI actions happen while ElevenLabs is still speaking
 */

import { useAgentStore } from "./store";
import { speak, cancelSpeak } from "./voice";

type SpeakingPriority = "elevenlabs" | "ui" | null;

interface QueuedSpeech {
  text: string;
  priority: Exclude<SpeakingPriority, "elevenlabs">;
  resolve: () => void;
}

// Module-level state (singleton across all components)
let currentPriority: SpeakingPriority = null;
let speechQueue: QueuedSpeech[] = [];
let activeStopFn: (() => void) | null = null;
let isUserSpeaking = false;

/**
 * Request TTS with priority coordination.
 * Returns a promise that resolves when speech completes or is cancelled.
 */
export async function requestSpeak(
  text: string,
  priority: "elevenlabs" | "ui",
): Promise<void> {
  // User speaking always cancels everything
  if (isUserSpeaking) {
    return;
  }

  // ElevenLabs priority: interrupt any current speech
  if (priority === "elevenlabs") {
    if (currentPriority === "elevenlabs" && activeStopFn) {
      // Already speaking at same priority, queue for sequential
      return queueSpeech(text, priority);
    }
    // Interrupt current speech
    cancelAllSpeech();
    currentPriority = "elevenlabs";
    return doSpeak(text, priority);
  }

  // UI priority: queue if ElevenLabs is speaking
  if (currentPriority === "elevenlabs") {
    return queueSpeech(text, priority);
  }

  // No conflict, speak immediately
  currentPriority = "ui";
  return doSpeak(text, priority);
}

/**
 * Cancel all active and queued speech.
 */
export function cancelAllSpeech(): void {
  if (activeStopFn) {
    activeStopFn();
    activeStopFn = null;
  }
  cancelSpeak();
  currentPriority = null;
  speechQueue = [];
}

/**
 * Notify that user started speaking (interrupts all TTS).
 */
export function notifyUserStartedSpeaking(): void {
  isUserSpeaking = true;
  cancelAllSpeech();
  // Clear queue since user's new input takes precedence
  speechQueue = [];
}

/**
 * Notify that user stopped speaking.
 * Resumes queued speech if any.
 */
export function notifyUserStoppedSpeaking(): void {
  isUserSpeaking = false;
  processQueue();
}

/**
 * Check if any TTS is currently active.
 */
export function isSpeaking(): boolean {
  return currentPriority !== null;
}

/**
 * Check if ElevenLabs has the speaking priority.
 */
export function isElevenLabsSpeaking(): boolean {
  return currentPriority === "elevenlabs";
}

/**
 * Get current speaking priority.
 */
export function getSpeakingPriority(): SpeakingPriority {
  return currentPriority;
}

// Internal: queue speech for later
function queueSpeech(
  text: string,
  priority: Exclude<SpeakingPriority, "elevenlabs">,
): Promise<void> {
  return new Promise((resolve) => {
    speechQueue.push({ text, priority, resolve });
  });
}

// Internal: process speech queue
async function processQueue(): Promise<void> {
  if (isUserSpeaking || currentPriority !== null || speechQueue.length === 0) {
    return;
  }

  const next = speechQueue.shift();
  if (!next) return;

  currentPriority = next.priority;
  await doSpeak(next.text, next.priority);
  next.resolve();

  // Continue processing queue
  processQueue();
}

// Internal: execute speech
async function doSpeak(
  text: string,
  priority: SpeakingPriority,
): Promise<void> {
  return new Promise((resolve) => {
    const stopFn = speak(text, {
      onStart: () => {
        // Update dock state for UI visibility
        if (priority === "elevenlabs") {
          useAgentStore.getState().setDock("speaking");
        }
      },
      onEnd: () => {
        activeStopFn = null;
        if (currentPriority === priority) {
          currentPriority = null;
        }
        // Only reset dock if we're not processing more queue items
        if (speechQueue.length === 0 && !isUserSpeaking) {
          const state = useAgentStore.getState();
          if (state.dock === "speaking") {
            state.setDock("idle");
          }
        }
        resolve();
        // Process next in queue
        processQueue();
      },
    });

    stopFn.then((fn) => {
      activeStopFn = fn;
    });
  });
}

/**
 * React hook for voice coordination state.
 */
export function useVoiceCoordination() {
  return {
    requestSpeak,
    cancelAllSpeech,
    notifyUserStartedSpeaking,
    notifyUserStoppedSpeaking,
    isSpeaking,
    isElevenLabsSpeaking,
    getSpeakingPriority,
  };
}
