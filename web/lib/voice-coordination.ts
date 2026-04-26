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
import { speak, cancelSpeak, isTTSPlaying, onTTSStateChange } from "./voice";
import { playBase64Audio, getIsAudioPlaying } from "./audio-player";
import { base64ToArrayBuffer, decodeAudioData, decodeMulawToPCM, pcmToAudioBuffer } from "./audio-utils";

type SpeakingPriority = "elevenlabs" | "ui" | null;

interface QueuedSpeech {
  text: string;
  priority: Exclude<SpeakingPriority, "elevenlabs">;
  resolve: () => void;
}

interface AudioChunk {
  base64: string;
  timestamp: number;
}

// Module-level state (singleton across all components)
let currentPriority: SpeakingPriority = null;
let speechQueue: QueuedSpeech[] = [];
let activeStopFn: (() => void) | null = null;
let isUserSpeaking = false;
let isAudioPlaying = false;

// Streaming audio state
let streamingAudioContext: AudioContext | null = null;
let streamingAudioQueue: AudioChunk[] = [];
let isPlayingStreamingAudio = false;
let streamingAudioSource: AudioBufferSourceNode | null = null;
let streamingPlaybackStartTime = 0;
let streamingChunkDuration = 0;

// Track audio state changes
onTTSStateChange((playing) => {
  console.log("[voice-coordination] TTS state changed:", playing);
  isAudioPlaying = playing;
});

/**
 * Request TTS with priority coordination.
 * Returns a promise that resolves when speech completes or is cancelled.
 */
export async function requestSpeak(
  text: string,
  priority: "elevenlabs" | "ui",
): Promise<void> {
  console.log(`[voice-coordination] requestSpeak called, priority: ${priority}, text: "${text.substring(0, 30)}..."`);
  
  // User speaking always cancels everything
  if (isUserSpeaking) {
    console.log("[voice-coordination] User is speaking, cancelling request");
    return;
  }

  // ElevenLabs priority: interrupt any current speech
  if (priority === "elevenlabs") {
    console.log("[voice-coordination] ElevenLabs priority request");
    if (currentPriority === "elevenlabs" && activeStopFn) {
      // Already speaking at same priority, queue for sequential
      console.log("[voice-coordination] Already speaking at ElevenLabs priority, queuing");
      return queueSpeech(text, priority);
    }
    // Interrupt current speech
    console.log("[voice-coordination] Interrupting current speech for ElevenLabs");
    cancelAllSpeech();
    currentPriority = "elevenlabs";
    return doSpeak(text, priority);
  }

  // UI priority: queue if ElevenLabs is speaking
  if (currentPriority === "elevenlabs") {
    console.log("[voice-coordination] UI priority but ElevenLabs is speaking, queuing");
    return queueSpeech(text, priority);
  }

  // No conflict, speak immediately
  console.log("[voice-coordination] Speaking immediately with UI priority");
  currentPriority = "ui";
  return doSpeak(text, priority);
}

/**
 * Cancel all active and queued speech.
 */
export function cancelAllSpeech(): void {
  console.log("[voice-coordination] cancelAllSpeech called");
  if (activeStopFn) {
    console.log("[voice-coordination] Calling active stop function");
    activeStopFn();
    activeStopFn = null;
  }
  console.log("[voice-coordination] Calling cancelSpeak");
  cancelSpeak();

  // Also clear streaming audio
  clearStreamingAudioQueue();

  currentPriority = null;
  speechQueue = [];
  console.log("[voice-coordination] All speech cancelled, queue cleared");
}

/**
 * Notify that user started speaking (interrupts all TTS).
 */
export function notifyUserStartedSpeaking(): void {
  console.log("[voice-coordination] User started speaking");
  isUserSpeaking = true;
  cancelAllSpeech();
  // Clear streaming audio queue since user's new input takes precedence
  clearStreamingAudioQueue();
  // Clear speech queue since user's new input takes precedence
  speechQueue = [];
}

/**
 * Notify that user stopped speaking.
 * Resumes queued speech if any.
 */
export function notifyUserStoppedSpeaking(): void {
  console.log("[voice-coordination] User stopped speaking, processing queue");
  isUserSpeaking = false;
  processQueue();
}

/**
 * Check if any TTS is currently active.
 */
export function isSpeaking(): boolean {
  const speaking = currentPriority !== null || isAudioPlaying || getIsAudioPlaying();
  return speaking;
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

/**
 * Check if audio is currently playing (for feedback prevention)
 */
export function isAudioCurrentlyPlaying(): boolean {
  return isAudioPlaying || getIsAudioPlaying() || isTTSPlaying();
}

// Internal: queue speech for later
function queueSpeech(
  text: string,
  priority: SpeakingPriority,
): Promise<void> {
  console.log(`[voice-coordination] Queuing speech, priority: ${priority}, queue length: ${speechQueue.length}`);
  return new Promise((resolve) => {
    speechQueue.push({ text, priority: priority as Exclude<SpeakingPriority, "elevenlabs">, resolve });
  });
}

// Internal: process speech queue
async function processQueue(): Promise<void> {
  console.log(`[voice-coordination] processQueue called, isUserSpeaking: ${isUserSpeaking}, currentPriority: ${currentPriority}, queueLength: ${speechQueue.length}`);
  
  if (isUserSpeaking || currentPriority !== null || speechQueue.length === 0) {
    console.log("[voice-coordination] Queue processing skipped - user speaking, already speaking, or empty queue");
    return;
  }

  const next = speechQueue.shift();
  if (!next) return;

  console.log(`[voice-coordination] Processing queued speech, priority: ${next.priority}`);
  currentPriority = next.priority;
  await doSpeak(next.text, next.priority);
  next.resolve();

  // Continue processing queue
  console.log("[voice-coordination] Finished queued speech, checking for more");
  processQueue();
}

// Internal: execute speech
async function doSpeak(
  text: string,
  priority: SpeakingPriority,
): Promise<void> {
  console.log(`[voice-coordination] doSpeak called, priority: ${priority}, text: "${text.substring(0, 40)}..."`);
  
  return new Promise((resolve) => {
    console.log("[voice-coordination] Calling speak()...");
    
    const stopFn = speak(text, {
      onStart: () => {
        console.log(`[voice-coordination] Speech started, priority: ${priority}`);
        // Update dock state for UI visibility
        if (priority === "elevenlabs") {
          console.log("[voice-coordination] Setting dock to 'speaking'");
          useAgentStore.getState().setDock("speaking");
        }
      },
      onEnd: () => {
        console.log(`[voice-coordination] Speech ended, priority: ${priority}`);
        activeStopFn = null;
        if (currentPriority === priority) {
          currentPriority = null;
        }
        // Only reset dock if we're not processing more queue items
        if (speechQueue.length === 0 && !isUserSpeaking) {
          const state = useAgentStore.getState();
          if (state.dock === "speaking") {
            console.log("[voice-coordination] Resetting dock to 'idle'");
            state.setDock("idle");
          }
        }
        resolve();
        // Process next in queue
        processQueue();
      },
    });

    stopFn.then((fn) => {
      console.log("[voice-coordination] Speak promise resolved, stop function stored");
      activeStopFn = fn;
    }).catch((err) => {
      console.error("[voice-coordination] Speak promise rejected:", err);
      activeStopFn = null;
      if (currentPriority === priority) {
        currentPriority = null;
      }
      resolve();
    });
  });
}

/**
 * Play base64 audio directly (for streaming audio from ElevenLabs)
 * This bypasses the TTS pipeline and plays audio immediately
 */
export async function playAudioFromBase64(
  base64Audio: string,
  priority: "elevenlabs" | "ui" = "elevenlabs"
): Promise<() => void> {
  console.log(`[voice-coordination] playAudioFromBase64 called, priority: ${priority}, audio length: ${base64Audio.length}`);
  
  // Cancel current speech if ElevenLabs has priority
  if (priority === "elevenlabs" && currentPriority !== null) {
    console.log("[voice-coordination] Interrupting current speech for streaming audio");
    cancelAllSpeech();
  }
  
  currentPriority = priority;
  
  // Set dock state
  if (priority === "elevenlabs") {
    useAgentStore.getState().setDock("speaking");
  }
  
  let hasEnded = false;
  
  const stopFn = await playBase64Audio(base64Audio, {
    onStart: () => {
      console.log("[voice-coordination] Base64 audio playback started");
      isAudioPlaying = true;
    },
    onEnd: () => {
      if (hasEnded) return;
      hasEnded = true;
      console.log("[voice-coordination] Base64 audio playback ended");
      isAudioPlaying = false;
      if (currentPriority === priority) {
        currentPriority = null;
      }
      // Reset dock if no more items
      if (speechQueue.length === 0 && !isUserSpeaking) {
        const state = useAgentStore.getState();
        if (state.dock === "speaking") {
          state.setDock("idle");
        }
      }
    },
    onError: (err) => {
      console.error("[voice-coordination] Base64 audio playback error:", err);
      isAudioPlaying = false;
      if (currentPriority === priority) {
        currentPriority = null;
      }
    },
  });
  
  activeStopFn = stopFn;
  
  return () => {
    console.log("[voice-coordination] Stopping base64 audio playback");
    stopFn();
    activeStopFn = null;
    isAudioPlaying = false;
    if (currentPriority === priority) {
      currentPriority = null;
    }
  };
}

/**
 * Decode base64 audio using Web Audio API
 * Supports both standard audio formats and μ-law encoded audio from ElevenLabs
 */
async function decodeStreamingAudio(
  ctx: AudioContext,
  base64Audio: string
): Promise<AudioBuffer> {
  try {
    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    return await decodeAudioData(ctx, arrayBuffer);
  } catch (err) {
    // If standard decode fails, try μ-law decode (ElevenLabs format)
    console.log("[voice-coordination] Standard decode failed, trying μ-law...");
    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    const mulawData = new Uint8Array(arrayBuffer);
    const pcmData = decodeMulawToPCM(mulawData);
    return pcmToAudioBuffer(ctx, pcmData, 8000); // μ-law is typically 8kHz
  }
}

/**
 * Play streaming audio queue continuously
 * Schedules audio chunks for seamless playback
 */
async function playStreamingAudioQueue(): Promise<void> {
  if (!streamingAudioContext) {
    streamingAudioContext = new (window.AudioContext ||
      (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }

  // Resume context if suspended (browser autoplay policy)
  if (streamingAudioContext.state === "suspended") {
    await streamingAudioContext.resume();
  }

  while (streamingAudioQueue.length > 0 && isPlayingStreamingAudio && !isUserSpeaking) {
    const chunk = streamingAudioQueue.shift();
    if (!chunk) continue;

    try {
      const audioBuffer = await decodeStreamingAudio(streamingAudioContext, chunk.base64);

      // Schedule playback for seamless audio
      const source = streamingAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(streamingAudioContext.destination);

      // Calculate when to start this chunk
      const currentTime = streamingAudioContext.currentTime;
      const startTime = Math.max(currentTime, streamingPlaybackStartTime + streamingChunkDuration);

      source.start(startTime);
      streamingAudioSource = source;
      streamingPlaybackStartTime = startTime;
      streamingChunkDuration = audioBuffer.duration;

      // Wait for this chunk to finish before processing next
      await new Promise<void>((resolve) => {
        source.onended = () => {
          streamingAudioSource = null;
          resolve();
        };
      });
    } catch (err) {
      console.error("[voice-coordination] Failed to play audio chunk:", err);
    }
  }

  // If no more chunks and we've finished playing, clean up
  if (streamingAudioQueue.length === 0 && isPlayingStreamingAudio) {
    isPlayingStreamingAudio = false;
    streamingPlaybackStartTime = 0;
    streamingChunkDuration = 0;

    // Reset priority if this was ElevenLabs speaking
    if (currentPriority === "elevenlabs") {
      currentPriority = null;
    }

    // Reset dock state
    const state = useAgentStore.getState();
    if (state.dock === "speaking") {
      state.setDock("idle");
    }
  }
}

/**
 * Add a base64 audio chunk to the streaming queue
 * Starts playback if not already playing
 */
export function queueStreamingAudioChunk(
  base64Audio: string,
  priority: "elevenlabs" | "ui" = "elevenlabs"
): void {
  if (isUserSpeaking) {
    // Discard audio chunks while user is speaking (echo cancellation)
    return;
  }

  // Set priority
  if (priority === "elevenlabs" && currentPriority !== "elevenlabs") {
    // Interrupt any current speech for ElevenLabs
    cancelAllSpeech();
    currentPriority = "elevenlabs";
  }

  // Add chunk to queue
  streamingAudioQueue.push({
    base64: base64Audio,
    timestamp: Date.now(),
  });

  // Start playback if not already playing
  if (!isPlayingStreamingAudio) {
    isPlayingStreamingAudio = true;
    streamingPlaybackStartTime = 0;
    streamingChunkDuration = 0;

    if (priority === "elevenlabs") {
      useAgentStore.getState().setDock("speaking");
    }

    void playStreamingAudioQueue();
  }
}

/**
 * Clear the streaming audio queue and stop playback
 */
export function clearStreamingAudioQueue(): void {
  console.log("[voice-coordination] Clearing streaming audio queue");

  // Stop current source
  if (streamingAudioSource) {
    try {
      streamingAudioSource.stop();
    } catch {
      // Ignore errors
    }
    streamingAudioSource = null;
  }

  // Clear queue
  streamingAudioQueue = [];
  isPlayingStreamingAudio = false;
  streamingPlaybackStartTime = 0;
  streamingChunkDuration = 0;

  // Reset priority
  if (currentPriority === "elevenlabs") {
    currentPriority = null;
  }
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
    isAudioCurrentlyPlaying,
    playAudioFromBase64,
    queueStreamingAudioChunk,
    clearStreamingAudioQueue,
  };
}
