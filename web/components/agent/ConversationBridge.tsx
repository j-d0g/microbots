"use client";

/**
 * ConversationBridge
 *
 * Real-time voice conversation with ElevenLabs Conversational AI via WebSocket.
 * Streams audio bidirectionally: microphone → ElevenLabs → speakers.
 *
 * Pipeline
 * ────────
 *   mic (MediaRecorder/webm) → WebSocket → ElevenLabs ConvAI
 *                                       ↓
 *   speakers ← AudioContext ← audio (base64 PCM/mulaw)
 *
 *   user_transcript → parseIntent → UI actions
 *   agent_response → parseIntent → UI actions
 *
 * Lifecycle
 * ─────────
 *   - Mounts when `conversationMode === true`
 *   - Connects WebSocket to wss://api.elevenlabs.io/v1/convai/agents/{agent_id}/stream
 *   - Captures microphone audio and sends via user_audio messages
 *   - Receives agent audio and plays via Web Audio API
 *   - Disconnects when `conversationMode` becomes false
 *   - Auto-reconnects on error with exponential backoff
 */

import { useCallback, useEffect, useRef } from "react";
import { useAgentStore, type WindowKind } from "@/lib/store";
import { parseIntent, type ParseResult } from "@/lib/agent/intent-parser";
import type { IntentSummary, ConversationTurn } from "@/lib/agent/conversation-types";
import { AgentFallback, applyAgentEvent, sendQuery } from "@/lib/agent-client";
import { routeIntent } from "@/lib/agent-router";

/* The real ElevenLabs ConvAI WebSocket protocol uses nested event
 * envelopes — NOT the flat `{ type, text, audio }` shape we used to
 * parse. The fields below match the documented payloads:
 *   user_transcript        → user_transcription_event.user_transcript
 *   agent_response         → agent_response_event.agent_response
 *   audio                  → audio_event.audio_base_64 (+ event_id)
 *   ping                   → ping_event.event_id (we MUST reply with pong)
 *   interruption           → interruption_event.event_id
 *   conversation_initiation_metadata, agent_response_correction,
 *   internal_tentative_agent_response are also possible. */
interface ElevenLabsWebSocketMessage {
  type: string;
  user_transcription_event?: { user_transcript?: string };
  agent_response_event?: { agent_response?: string };
  audio_event?: { audio_base_64?: string; event_id?: number };
  ping_event?: { event_id?: number; ping_ms?: number };
  interruption_event?: { event_id?: number };
  conversation_initiation_metadata_event?: {
    conversation_id?: string;
    agent_output_audio_format?: string;
    user_input_audio_format?: string;
  };
  /* Client-tool calls. Defined in the ElevenLabs agent dashboard, the
   * agent emits one of these whenever it decides to run a tool that
   * lives in the browser. We forward the call to our UI agent and reply
   * with a `client_tool_result`. */
  client_tool_call?: {
    tool_name: string;
    tool_call_id: string;
    parameters?: Record<string, unknown>;
  };
  // Errors are surfaced as a flat `message`/`error` field by the server.
  message?: string;
  error?: string;
}

// Connection retry configuration
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;

export function ConversationBridge() {
  const conversationMode = useAgentStore((s) => s.conversationMode);
  const setDock = useAgentStore((s) => s.setDock);
  const setIsAgentSpeaking = useAgentStore((s) => s.setIsAgentSpeaking);
  const appendChatMessage = useAgentStore((s) => s.appendChatMessage);
  const addConversationTurn = useAgentStore((s) => s.addConversationTurn);
  const setCurrentIntent = useAgentStore((s) => s.setCurrentIntent);

  // WebSocket and audio refs
  const wsRef = useRef<WebSocket | null>(null);
  /* Two AudioContexts: input (mic capture, locked to 16 kHz to match
   * the ConvAI input format) and output (playback at whatever rate
   * the agent uses; default 16 kHz pcm_s16le). They must be separate
   * because the mic capture path needs an AudioWorklet/ScriptProcessor
   * tied to the 16 kHz context, while the playback path scheduling is
   * independent. */
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackTimeRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  /* Output sample rate is announced by the server in the
   * conversation_initiation_metadata event (e.g. "pcm_16000",
   * "pcm_24000", "ulaw_8000"). Default to 16 kHz PCM16 — the most
   * common configuration. */
  const outputSampleRateRef = useRef(16000);
  const outputFormatRef = useRef<"pcm" | "ulaw">("pcm");
  const pendingTranscriptRef = useRef<string>("");
  const pendingResponseRef = useRef<string>("");

  /* ── tool-call delivery guarantee ─────────────────────────────────
   *
   * Every `client_tool_call` from ElevenLabs MUST reach the Gemini
   * orchestrator, regardless of how many calls overlap or what else
   * the page is doing. We can't rely on parallel `sendQuery` because:
   *
   *   1. Each `sendQuery` posts a fresh snapshot. Two parallel calls
   *      both observe the pre-call snapshot, so the second runs
   *      against stale state — its UI mutations race the first
   *      orchestrate's mutations and one usually loses.
   *   2. No retry on transient network blips → silently dropped turn.
   *   3. No timeout → a hung route blocks all subsequent calls.
   *
   * Solution: a FIFO queue drained by a single async worker. Each
   * call gets a fresh snapshot at dispatch time (so it sees the
   * previous call's effects), a 30 s abort timeout, and one retry
   * on non-fallback failure. ElevenLabs is acked immediately on
   * receipt so the voice channel keeps flowing while the queue runs
   * in the background. */
  type QueuedToolCall = {
    runId: string;
    toolName: string;
    params: Record<string, unknown>;
    enqueuedAt: number;
  };
  const toolQueueRef = useRef<QueuedToolCall[]>([]);
  const queueWorkerActiveRef = useRef(false);

  // Agent ID is fine to expose — it's just a public identifier. The
  // xi-api-key is NOT — it stays server-side, used to mint a short-lived
  // signed WebSocket URL via /api/elevenlabs/signed-url. Never read or
  // expose NEXT_PUBLIC_ELEVENLABS_API_KEY: ElevenLabs rejects API keys
  // in WebSocket query strings AND it leaks paid credentials to every
  // browser that loads the page.
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_CONVAI_AGENT_ID || "";

  // Cleanup function
  const cleanup = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Tear down mic capture (processor → source → stream).
    if (inputProcessorRef.current) {
      try {
        inputProcessorRef.current.disconnect();
      } catch {
        /* ignore */
      }
      inputProcessorRef.current.onaudioprocess = null;
      inputProcessorRef.current = null;
    }
    if (inputSourceRef.current) {
      try {
        inputSourceRef.current.disconnect();
      } catch {
        /* ignore */
      }
      inputSourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (inputCtxRef.current && inputCtxRef.current.state !== "closed") {
      try {
        void inputCtxRef.current.close();
      } catch {
        /* ignore */
      }
    }
    inputCtxRef.current = null;

    // Close WebSocket
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      try {
        ws.close(1000, "Cleanup");
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Close playback context
    if (outputCtxRef.current && outputCtxRef.current.state !== "closed") {
      try {
        void outputCtxRef.current.close();
      } catch {
        /* ignore */
      }
    }
    outputCtxRef.current = null;
    playbackTimeRef.current = 0;

    // Reset state
    pendingTranscriptRef.current = "";
    pendingResponseRef.current = "";
    setIsAgentSpeaking(false);
  }, [setIsAgentSpeaking]);

  /* Decode + schedule a base64-encoded audio chunk from the agent.
   *
   * Format is announced by `conversation_initiation_metadata`. The two
   * supported shapes for ConvAI today:
   *   - pcm_<rate>   → 16-bit signed little-endian PCM at <rate> Hz
   *   - ulaw_8000    → 8-bit μ-law at 8 kHz
   *
   * Each chunk is small (~tens of ms) and arrives in order; we schedule
   * them back-to-back on a shared AudioContext clock to avoid gaps and
   * the click-pop of starting a fresh BufferSource each tick. */
  const playAudioChunk = useCallback(async (audioBase64: string) => {
    console.log("[ConversationBridge] playAudioChunk called, base64 length:", audioBase64?.length);
    
    if (!audioBase64 || audioBase64.length < 4) {
      console.warn("[ConversationBridge] Audio chunk too short, skipping");
      return;
    }
    
    try {
      // Create AudioContext if needed
      if (!outputCtxRef.current) {
        console.log("[ConversationBridge] Creating new output AudioContext");
        const Ctor =
          window.AudioContext ||
          (window as typeof window & {
            webkitAudioContext: typeof AudioContext;
          }).webkitAudioContext;
        outputCtxRef.current = new Ctor();
        playbackTimeRef.current = outputCtxRef.current.currentTime;
        console.log("[ConversationBridge] AudioContext created, currentTime:", playbackTimeRef.current);
      }
      
      const ctx = outputCtxRef.current;
      
      // CRITICAL: Resume AudioContext if suspended (browser autoplay policy)
      if (ctx.state === "suspended") {
        console.log("[ConversationBridge] Resuming suspended AudioContext");
        try {
          await ctx.resume();
          console.log("[ConversationBridge] AudioContext resumed successfully, state:", ctx.state);
        } catch (resumeErr) {
          console.error("[ConversationBridge] Failed to resume AudioContext:", resumeErr);
          return;
        }
      }
      
      const sampleRate = outputSampleRateRef.current;
      const format = outputFormatRef.current;
      console.log("[ConversationBridge] Audio format:", format, "sampleRate:", sampleRate);

      // Decode base64
      console.log("[ConversationBridge] Decoding base64 audio...");
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      } catch (atobErr) {
        console.error("[ConversationBridge] Base64 decode failed:", atobErr);
        return;
      }
      console.log("[ConversationBridge] Decoded bytes:", bytes.length, "format:", format);

      let float32: Float32Array;
      if (format === "ulaw") {
        console.log("[ConversationBridge] Decoding ulaw audio");
        float32 = new Float32Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
          const u = ~bytes[i]! & 0xff;
          const sign = u & 0x80 ? -1 : 1;
          const exponent = (u >> 4) & 0x07;
          const mantissa = u & 0x0f;
          const sample =
            sign * (((mantissa << 1) | 0x21) << exponent) - sign * 0x21;
          float32[i] = sample / 32768;
        }
      } else {
        console.log("[ConversationBridge] Decoding PCM16 audio");
        // PCM16 little-endian → Float32 [-1, 1)
        const samples = new Int16Array(
          bytes.buffer,
          bytes.byteOffset,
          Math.floor(bytes.byteLength / 2),
        );
        float32 = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          float32[i] = samples[i]! / 32768;
        }
      }

      if (float32.length === 0) {
        console.warn("[ConversationBridge] No audio samples after decode");
        return;
      }
      
      console.log("[ConversationBridge] Audio samples:", float32.length, "duration:", (float32.length / sampleRate).toFixed(3), "seconds");

      const buffer = ctx.createBuffer(1, float32.length, sampleRate);
      // Avoid TS5.7 strict-typedarray friction with Float32Array<ArrayBufferLike>
      // by writing into the channel directly.
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const startAt = Math.max(playbackTimeRef.current, ctx.currentTime);
      console.log("[ConversationBridge] Scheduling audio at:", startAt.toFixed(3), "currentTime:", ctx.currentTime.toFixed(3));
      source.start(startAt);
      playbackTimeRef.current = startAt + buffer.duration;

      setIsAgentSpeaking(true);
      setDock("speaking");
      console.log("[ConversationBridge] Audio chunk scheduled, isAgentSpeaking=true");

      // After this chunk finishes, if no further chunk has been queued
      // beyond `playbackTimeRef`, we're done speaking.
      source.onended = () => {
        const ahead = playbackTimeRef.current - ctx.currentTime;
        console.log("[ConversationBridge] Audio chunk ended, ahead:", ahead.toFixed(3), "seconds");
        if (ahead <= 0.05) {
          console.log("[ConversationBridge] All audio played, setting isAgentSpeaking=false");
          setIsAgentSpeaking(false);
          setDock("conversing");
        }
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[conversation-bridge] Audio playback error:", err);
      setIsAgentSpeaking(false);
      setDock("conversing");
    }
  }, [setDock, setIsAgentSpeaking]);

  // Process incoming message and extract intent
  const processAgentResponse = useCallback((text: string) => {
    console.log("[ConversationBridge] Processing agent response:", text);
    
    const { intent }: ParseResult = parseIntent(text);
    console.log("[ConversationBridge] Parsed intent:", intent);
    
    // Update current intent in store
    setCurrentIntent(intent);

    // Add to conversation history
    const turn: ConversationTurn = {
      id: `agent-${Date.now()}`,
      role: "agent",
      text,
      timestamp: Date.now(),
      intent,
      room: useAgentStore.getState().chatRoom,
    };
    addConversationTurn(turn);

    // Append to chat
    appendChatMessage({
      id: `agent-${Date.now()}`,
      role: "agent",
      text,
      ts: Date.now(),
      room: useAgentStore.getState().chatRoom,
    });

    // Route the intent via direct store manipulation for immediate UI updates
    if (intent.action === "navigate" && intent.target) {
      const room = intent.target as WindowKind;
      console.log("[ConversationBridge] Navigate intent - opening window:", room);
      if (room) {
        const store = useAgentStore.getState();
        console.log("[ConversationBridge] Before - current windows:", store.windows.map(w => w.kind));
        store.openWindow(room);
        store.setChatRoom(room);
        console.log("[ConversationBridge] After - current windows:", store.windows.map(w => w.kind));
      }
    }
  }, [addConversationTurn, appendChatMessage, setCurrentIntent]);

  /* Single client tool: `run_ui_agent({ query })`. The voice agent
   * extracts the UI command from the user's speech in one short
   * sentence and passes it here; we forward to the orchestrator.
   *
   * Configure on the ElevenLabs agent (Dashboard → Tools → Client
   * tool) with this minimal description (~40 tokens):
   *
   *   "Run a UI command. Pass one short imperative sentence
   *    describing what to do on screen, extracted from the user's
   *    speech. Examples: 'open the graph', 'show integrations',
   *    'find notes about hackathon'."
   *
   * Parameter: query (string, required). */
  /* Extract the imperative query string from arbitrary tool params.
   * Agents sometimes rename the parameter after the tool itself, so we
   * accept several candidate keys and finally fall back to the first
   * string-valued field. */
  const extractQuery = useCallback(
    (params: Record<string, unknown>): string => {
      const candidateKeys = ["query", "run_ui_agent", "command", "input"];
      for (const k of candidateKeys) {
        const v = params[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      for (const v of Object.values(params)) {
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    },
    [],
  );

  /* Dispatch ONE orchestrator round-trip. Used by the queue worker.
   * Returns true on success (including local fallback), false on a
   * non-recoverable failure that the worker may want to retry. */
  const dispatchOneToolCall = useCallback(
    async (call: QueuedToolCall, attempt: number): Promise<boolean> => {
      const { runId, toolName, params } = call;
      if (toolName !== "run_ui_agent") {
        // eslint-disable-next-line no-console
        console.warn(
          `[conversation-bridge] ${runId} unknown tool:`,
          toolName,
        );
        return true; // nothing we can do; treat as terminal
      }
      const query = extractQuery(params);
      if (!query) {
        // eslint-disable-next-line no-console
        console.warn(
          `[conversation-bridge] ${runId} missing string param; got:`,
          params,
        );
        return true;
      }

      const startedAt = performance.now();
      // eslint-disable-next-line no-console
      console.log(
        `[conversation-bridge] ${runId} ▶ attempt ${attempt + 1}:`,
        query,
      );

      /* Eager UI: dock + chat row + sidecar entry on the first
       * attempt only — re-recording on retry would duplicate the
       * user message. */
      if (attempt === 0) {
        const store = useAgentStore.getState();
        store.setDock("thinking");
        const last = store.chatMessages.at(-1);
        const alreadyRecorded =
          last?.role === "user" && last.text.trim() === query;
        if (!alreadyRecorded) {
          store.appendChatMessage({
            id: `user-${Date.now()}`,
            role: "user",
            text: query,
            ts: Date.now(),
            room: store.chatRoom,
          });
        }
        store.pushAction({
          t: Date.now(),
          tool: "run_ui_agent",
          args: { query, runId },
          ok: true,
        });
      }

      /* 30 s hard ceiling: if the route hangs, abort and let the
       * worker retry. Without this a stuck request would block the
       * entire queue indefinitely. */
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 30_000);

      try {
        await sendQuery(query, controller.signal);
        clearTimeout(timeoutId);
        const ms = Math.round(performance.now() - startedAt);
        // eslint-disable-next-line no-console
        console.log(
          `[conversation-bridge] ${runId} ✔ (${ms}ms, attempt ${attempt + 1})`,
        );
        return true;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof AgentFallback) {
          /* No API key / 503 / unreachable — run the scripted local
           * fallback so the UI still does *something*. Treat as
           * success: retrying would just hit the same fallback. */
          try {
            for await (const evt of routeIntent(query)) {
              applyAgentEvent(evt);
            }
          } catch (fallbackErr) {
            // eslint-disable-next-line no-console
            console.error(
              `[conversation-bridge] ${runId} fallback failed:`,
              fallbackErr,
            );
          }
          // eslint-disable-next-line no-console
          console.warn(
            `[conversation-bridge] ${runId} ↻ local fallback:`,
            err.reason,
          );
          return true;
        }
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(
          `[conversation-bridge] ${runId} ✗ attempt ${attempt + 1}:`,
          msg,
        );
        return false;
      }
    },
    [extractQuery],
  );

  /* Drain the queue serially. Idempotent — multiple invocations
   * collapse into a single worker via `queueWorkerActiveRef`. */
  const drainToolQueue = useCallback(async () => {
    if (queueWorkerActiveRef.current) return;
    queueWorkerActiveRef.current = true;
    try {
      while (toolQueueRef.current.length > 0) {
        const call = toolQueueRef.current[0]!;
        let ok = await dispatchOneToolCall(call, 0);
        if (!ok) {
          /* One retry after a short backoff. Most transient errors
           * (network blip, edge cold-start) clear in well under a
           * second, so we don't waste the demo's time waiting. */
          await new Promise((r) => setTimeout(r, 750));
          ok = await dispatchOneToolCall(call, 1);
        }
        if (!ok) {
          /* Both attempts failed. Surface the failure as a toast so
           * a dropped turn isn't invisible, then move on — never
           * block the queue on a poison call. */
          applyAgentEvent({
            type: "ui.card",
            card: {
              id: `agent-err-${Date.now()}`,
              kind: "toast",
              data: {
                text: `agent error · ${call.runId} dropped after retry`,
              },
              ttl: 6000,
            },
          });
          useAgentStore.getState().setDock("idle");
        }
        toolQueueRef.current.shift();
      }
    } finally {
      queueWorkerActiveRef.current = false;
    }
  }, [dispatchOneToolCall]);

  /* Public entry point: enqueue a tool call and kick the worker.
   * Always returns immediately so the WebSocket handler can ack
   * ElevenLabs without waiting on Gemini. */
  const enqueueClientTool = useCallback(
    (toolName: string, params: Record<string, unknown> = {}) => {
      const runId = `run-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      toolQueueRef.current.push({
        runId,
        toolName,
        params,
        enqueuedAt: Date.now(),
      });
      // eslint-disable-next-line no-console
      console.log(
        `[conversation-bridge] enqueued ${runId} (queue depth ${toolQueueRef.current.length})`,
      );
      void drainToolQueue();
    },
    [drainToolQueue],
  );

  // Handle WebSocket message
  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    try {
      const message: ElevenLabsWebSocketMessage = JSON.parse(event.data);

      switch (message.type) {
        case "conversation_initiation_metadata": {
          /* Server tells us its output format on connect. Honor it so
           * the playback path decodes correctly. Format strings look
           * like "pcm_16000", "pcm_24000", "ulaw_8000". */
          const fmt =
            message.conversation_initiation_metadata_event
              ?.agent_output_audio_format ?? "pcm_16000";
          const [kind, rateStr] = fmt.split("_");
          outputFormatRef.current = kind === "ulaw" ? "ulaw" : "pcm";
          const parsed = Number(rateStr);
          if (Number.isFinite(parsed) && parsed > 0) {
            outputSampleRateRef.current = parsed;
          }
          // eslint-disable-next-line no-console
          console.log(
            "[conversation-bridge] init metadata",
            message.conversation_initiation_metadata_event,
          );
          break;
        }

        case "user_transcript": {
          const text =
            message.user_transcription_event?.user_transcript?.trim();
          if (text) {
            // eslint-disable-next-line no-console
            console.log("[conversation-bridge] user transcript:", text);
            pendingTranscriptRef.current = text;
            const id = `user-${Date.now()}`;
            addConversationTurn({
              id,
              role: "user",
              text,
              timestamp: Date.now(),
              room: useAgentStore.getState().chatRoom,
            });
            appendChatMessage({
              id,
              role: "user",
              text,
              ts: Date.now(),
              room: useAgentStore.getState().chatRoom,
            });
            setDock("thinking");
          }
          break;
        }

        case "agent_response": {
          /* Final agent text. ConvAI also emits
           * `internal_tentative_agent_response` for partials; we ignore
           * those for now and only commit on the final. */
          const text = message.agent_response_event?.agent_response?.trim();
          if (text) {
            pendingResponseRef.current = text;
            processAgentResponse(text);
          }
          break;
        }

        case "audio": {
          const b64 = message.audio_event?.audio_base_64;
          console.log("[ConversationBridge] Received audio message, base64 length:", b64?.length ?? 0);
          if (b64) {
            void playAudioChunk(b64);
          } else {
            console.warn("[ConversationBridge] Audio message has no audio_base_64 data");
          }
          break;
        }

        case "interruption": {
          /* The user interrupted the agent. Drop the rest of the
           * scheduled audio by tearing down the output context — any
           * future chunks will rebuild it on demand. */
          if (
            outputCtxRef.current &&
            outputCtxRef.current.state !== "closed"
          ) {
            try {
              void outputCtxRef.current.close();
            } catch {
              /* ignore */
            }
          }
          outputCtxRef.current = null;
          playbackTimeRef.current = 0;
          setIsAgentSpeaking(false);
          setDock("listening");
          break;
        }

        case "ping": {
          /* The server pings periodically to keep the connection alive
           * AND to measure RTT — we MUST reply with pong/<event_id> or
           * it will close the connection after a few missed beats. */
          const eventId = message.ping_event?.event_id;
          if (
            eventId !== undefined &&
            wsRef.current?.readyState === WebSocket.OPEN
          ) {
            wsRef.current.send(
              JSON.stringify({ type: "pong", event_id: eventId }),
            );
          }
          break;
        }

        case "client_tool_call": {
          /* The voice agent decided to invoke a client-side tool.
           *
           * IMPORTANT: we acknowledge ElevenLabs IMMEDIATELY ("ok") and
           * fire the UI agent (Gemini orchestrator) in the background.
           * If we awaited the orchestrator first, the voice agent would
           * pause for the entire LLM round-trip + tool execution before
           * speaking — which felt like the agent was frozen. Now both
           * pipelines run in parallel:
           *
           *   ElevenLabs (voice reply)   ─┐
           *                               ├─ both run concurrently
           *   Gemini orchestrator (UI)   ─┘
           *
           * The orchestrator's results still stream into the store via
           * applyAgentEvent, so the UI updates as soon as each event
           * arrives. ElevenLabs doesn't need to know whether the work
           * actually succeeded — its job is just to keep the
           * conversation natural. */
          const call = message.client_tool_call;
          if (!call) break;
          // eslint-disable-next-line no-console
          console.log(
            "[conversation-bridge] client_tool_call:",
            call.tool_name,
            call.parameters,
          );
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "client_tool_result",
                tool_call_id: call.tool_call_id,
                result: "ok",
                is_error: false,
              }),
            );
          }
          /* Enqueue and return — the queue worker drains serially
           * with timeout + retry. ElevenLabs already received its
           * `ok` ack above, so the voice channel is unblocked. */
          enqueueClientTool(call.tool_name, call.parameters ?? {});
          break;
        }

        case "agent_response_correction":
        case "internal_tentative_agent_response":
        case "vad_score": {
          // Not handled yet but expected — ignore quietly.
          break;
        }

        case "error": {
          // eslint-disable-next-line no-console
          console.error(
            "[conversation-bridge] ElevenLabs error:",
            message.message ?? message.error,
          );
          break;
        }

        default: {
          // eslint-disable-next-line no-console
          console.log(
            "[conversation-bridge] Unknown message type:",
            message.type,
          );
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[conversation-bridge] Failed to parse message:", err);
    }
  }, [playAudioChunk, processAgentResponse, enqueueClientTool, setDock, setIsAgentSpeaking, addConversationTurn, appendChatMessage]);

  /* Capture mic audio as PCM16 16 kHz mono (ConvAI's required input
   * format) and stream it as `{ user_audio_chunk: <base64> }` frames.
   *
   * MediaRecorder + opus DOES NOT WORK here — ElevenLabs rejects opus
   * over the ConvAI socket and the server silently drops the audio,
   * which is why nothing was ever transcribed. We instead route the
   * mic stream through an AudioContext locked to 16 kHz, grab raw
   * Float32 frames via a ScriptProcessorNode, downcast to Int16, and
   * base64-encode each ~256 ms chunk before sending. */
  const startMicrophoneCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      mediaStreamRef.current = stream;

      const Ctor =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext: typeof AudioContext;
        }).webkitAudioContext;
      // sampleRate hint isn't honoured everywhere (Firefox ignores it);
      // we resample on the fly when emitting.
      const ctx = new Ctor({ sampleRate: 16000 });
      inputCtxRef.current = ctx;
      // Some browsers start the context suspended until user gesture.
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          /* ignore */
        }
      }

      const source = ctx.createMediaStreamSource(stream);
      inputSourceRef.current = source;

      // 4096 frames @ 16 kHz ≈ 256 ms — small enough for low latency,
      // large enough that we're not screaming at the WS. ScriptProcessor
      // is deprecated but still universally supported and avoids the
      // worklet module loading dance for now.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      inputProcessorRef.current = processor;

      const targetRate = 16000;
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);

        // Downsample if the actual sample rate isn't 16 kHz (Firefox).
        let pcm: Float32Array;
        if (ctx.sampleRate === targetRate) {
          pcm = input;
        } else {
          const ratio = ctx.sampleRate / targetRate;
          const outLen = Math.floor(input.length / ratio);
          pcm = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) {
            pcm[i] = input[Math.floor(i * ratio)]!;
          }
        }

        // Float32 [-1, 1) → Int16 little-endian
        const int16 = new Int16Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) {
          const s = Math.max(-1, Math.min(1, pcm[i]!));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Base64-encode the underlying bytes. btoa() chokes on long
        // strings if we go char-by-char in one big String.fromCharCode
        // call, so chunk it.
        const bytes = new Uint8Array(int16.buffer);
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(i, i + CHUNK)),
          );
        }
        const b64 = btoa(binary);

        wsRef.current.send(JSON.stringify({ user_audio_chunk: b64 }));
      };

      source.connect(processor);
      // ScriptProcessor only fires while connected to destination on
      // some implementations. Use a muted gain so we don't echo the
      // mic to the speakers.
      const muted = ctx.createGain();
      muted.gain.value = 0;
      processor.connect(muted);
      muted.connect(ctx.destination);

      setDock("listening");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[conversation-bridge] Failed to start microphone:", err);
      throw err;
    }
  }, [setDock]);

  /* Stop the capture graph — the actual mic shutdown is in cleanup(). */
  const stopMicrophoneCapture = useCallback(() => {
    if (inputProcessorRef.current) {
      inputProcessorRef.current.onaudioprocess = null;
      try {
        inputProcessorRef.current.disconnect();
      } catch {
        /* ignore */
      }
      inputProcessorRef.current = null;
    }
    if (inputSourceRef.current) {
      try {
        inputSourceRef.current.disconnect();
      } catch {
        /* ignore */
      }
      inputSourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputCtxRef.current && inputCtxRef.current.state !== "closed") {
      try {
        void inputCtxRef.current.close();
      } catch {
        /* ignore */
      }
    }
    inputCtxRef.current = null;
  }, []);

  // Connect WebSocket
  const connectWebSocket = useCallback(async () => {
    if (isConnectingRef.current || !agentId) {
      if (!agentId) {
        // eslint-disable-next-line no-console
        console.error("[conversation-bridge] ELEVENLABS_CONVAI_AGENT_ID not set");
      }
      return;
    }

    isConnectingRef.current = true;

    try {
      /* Resolve the WS URL via our server. For private agents this is
       * a short-lived `signed_url` minted with the server-held
       * xi-api-key. For public agents we connect to the unauth'd public
       * endpoint at `/v1/convai/conversation?agent_id=…`.
       *
       * The previous implementation built `wss://…/agents/{id}/stream`
       * with `xi-api-key` as a query param. That path doesn't exist on
       * ElevenLabs' API and they reject auth via WS query string —
       * which is what produced the empty `Event {}` error: the handshake
       * was rejected, the close event carried 1006, and the only thing
       * the browser handed to `onerror` was a useless DOM Event. */
      let wsUrl: string;
      try {
        const res = await fetch("/api/elevenlabs/signed-url", {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => null)) as
          | { signed_url?: string | null; error?: string }
          | null;
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.error(
            "[conversation-bridge] /api/elevenlabs/signed-url failed:",
            res.status,
            body?.error,
          );
          isConnectingRef.current = false;
          return;
        }
        wsUrl =
          body?.signed_url ??
          `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;
      } catch (fetchErr) {
        // eslint-disable-next-line no-console
        console.error(
          "[conversation-bridge] failed to fetch signed url, falling back to public endpoint:",
          fetchErr,
        );
        wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        // eslint-disable-next-line no-console
        console.log("[conversation-bridge] WebSocket connected");
        reconnectAttemptsRef.current = 0;
        isConnectingRef.current = false;

        try {
          await startMicrophoneCapture();
        } catch {
          // Mic failed — we can still receive agent audio.
        }
      };

      ws.onmessage = handleWebSocketMessage;

      /* The native `error` event has no useful payload — the only
       * thing the browser exposes is "something went wrong". The close
       * event that always follows carries `code` + `reason`, which is
       * where the actual diagnostics go. */
      ws.onerror = () => {
        // eslint-disable-next-line no-console
        console.warn(
          "[conversation-bridge] WebSocket error event (close handler will report code/reason)",
        );
      };

      ws.onclose = (event) => {
        // eslint-disable-next-line no-console
        console.log("[conversation-bridge] WebSocket closed:", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        wsRef.current = null;
        isConnectingRef.current = false;
        stopMicrophoneCapture();

        if (!conversationMode) return;
        if (event.code === 1000 || event.code === 1001) return;
        /* ElevenLabs uses 4000-4999 for protocol-level rejections
         * (bad agent ID, missing/invalid signed URL, etc.). Retrying
         * just blasts the API with the same broken handshake. */
        if (event.code >= 4000 && event.code < 5000) {
          // eslint-disable-next-line no-console
          console.error(
            "[conversation-bridge] server rejected connection — not retrying",
          );
          setDock("idle");
          return;
        }

        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current),
          RECONNECT_MAX_DELAY_MS,
        );
        if (reconnectAttemptsRef.current < RECONNECT_MAX_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          // eslint-disable-next-line no-console
          console.log(
            `[conversation-bridge] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`,
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            void connectWebSocket();
          }, delay);
        } else {
          // eslint-disable-next-line no-console
          console.error("[conversation-bridge] Max reconnection attempts reached");
          setDock("idle");
        }
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[conversation-bridge] Failed to connect WebSocket:", err);
      isConnectingRef.current = false;
    }
  }, [agentId, conversationMode, handleWebSocketMessage, setDock, startMicrophoneCapture, stopMicrophoneCapture]);

  // Main effect: connect/disconnect based on conversationMode
  useEffect(() => {
    if (!conversationMode) {
      cleanup();
      return;
    }

    // Check for agent ID
    if (!agentId) {
      // eslint-disable-next-line no-console
      console.error("[conversation-bridge] ELEVENLABS_CONVAI_AGENT_ID not configured");
      return;
    }

    // Set initial dock state
    setDock("conversing");
    
    // Connect WebSocket
    void connectWebSocket();

    return () => {
      cleanup();
    };
  }, [conversationMode, agentId, connectWebSocket, cleanup, setDock]);

  return null;
}
