"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "./store";
import { blobToBase64, getBestMimeType } from "./audio-utils";

/* -------------------------------------------------------------------------
 * Voice layer
 *
 * Two providers, one interface:
 *   - "browser"     — Web Speech API (zero key)
 *   - "elevenlabs"  — server-held key, MediaRecorder ↑ /api/stt, /api/tts ↓
 *
 * The selection is made on mount via /api/voice/config (which inspects
 * env vars without leaking them) and cached in module scope. STT and
 * TTS are independently negotiated.
 * ----------------------------------------------------------------------- */

export type SttProvider = "elevenlabs" | "deepgram" | "browser";
export type TtsProvider = "elevenlabs" | "cartesia" | "browser";

interface VoiceConfig {
  stt: SttProvider;
  tts: TtsProvider;
}

let cachedConfig: VoiceConfig | null = null;
let inflight: Promise<VoiceConfig> | null = null;

export async function loadVoiceConfig(): Promise<VoiceConfig> {
  if (cachedConfig) return cachedConfig;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/voice/config", { cache: "no-store" });
      if (!res.ok) throw new Error(`voice config ${res.status}`);
      const data = (await res.json()) as VoiceConfig;
      cachedConfig = data;
      return data;
    } catch {
      cachedConfig = { stt: "browser", tts: "browser" };
      return cachedConfig;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useVoiceConfig(): VoiceConfig {
  const [cfg, setCfg] = useState<VoiceConfig>(
    cachedConfig ?? { stt: "browser", tts: "browser" },
  );
  useEffect(() => {
    let alive = true;
    loadVoiceConfig().then((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

/* ---------- STT session interface --------------------------------------
 *
 * Both providers fit the same shape:
 *   start() resolves when capture is live (mic permission granted, etc).
 *   stop() resolves with the FINAL transcript — meaning all in-flight
 *   audio has been transcribed. Critically this means the call site can
 *   release `.` mid-word and we still capture everything spoken while
 *   the key was held.
 * --------------------------------------------------------------------- */

interface SttSession {
  start: () => Promise<void>;
  stop: () => Promise<string>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        resultIndex: number;
        results: {
          length: number;
          [index: number]: { isFinal: boolean; 0: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const SR =
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  return (SR as new () => SpeechRecognitionLike) ?? null;
}

/* ---------- Web Speech session (browser native) ----------------------- */

function makeBrowserSttSession(opts: {
  onInterim?: (text: string) => void;
}): SttSession {
  let rec: SpeechRecognitionLike | null = null;
  let buffer = "";
  let endPromise: Promise<void> | null = null;

  return {
    async start() {
      const SR = getSpeechRecognition();
      if (!SR) {
        // Unsupported runtime — pre-fill with a deterministic dev sample
        // so the rest of the pipeline can still flow.
        buffer =
          "every morning I end up triaging the same product bugs from Slack into Linear";
        opts.onInterim?.(buffer);
        return;
      }
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      let resolveEnd: (() => void) | null = null;
      endPromise = new Promise<void>((res) => {
        resolveEnd = res;
      });

      rec.onresult = (event) => {
        let final = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          const txt = r[0].transcript;
          if (r.isFinal) final += txt + " ";
          else interim += txt;
        }
        if (final) buffer += final;
        opts.onInterim?.((buffer + interim).trim());
      };
      rec.onerror = () => resolveEnd?.();
      rec.onend = () => resolveEnd?.();

      rec.start();
    },
    async stop(): Promise<string> {
      if (!rec) return buffer.trim();
      try {
        rec.stop();
      } catch {
        /* already stopped — onend may already have fired */
      }
      // Wait for `onend` so any results that were in flight at release
      // time get appended to `buffer`. Safety timeout caps the wait.
      await Promise.race([
        endPromise ?? Promise.resolve(),
        new Promise<void>((res) => setTimeout(res, 1800)),
      ]);
      return buffer.trim();
    },
  };
}

/* ---------- ElevenLabs Scribe session (MediaRecorder ↑ /api/stt) ----- */

function makeElevenSttSession(): SttSession {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  const chunks: BlobPart[] = [];
  let stopped: Promise<void> | null = null;

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      stopped = new Promise<void>((res) => {
        recorder!.onstop = () => res();
      });
      // Slightly larger time-slice keeps fewer wasted boundary chunks
      // around release; the recorder still flushes everything on stop.
      recorder.start(500);
    },
    async stop(): Promise<string> {
      if (!recorder) return "";
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* already stopped */
      }
      await stopped;
      stream?.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      if (blob.size === 0) return "";

      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const res = await fetch("/api/stt", { method: "POST", body: form });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn("[voice] STT failed", await res.text().catch(() => ""));
        return "";
      }
      const { transcript } = (await res.json()) as { transcript: string };
      return transcript ?? "";
    },
  };
}

/* ---------- Voice confirm grammar ---------------------------------------- */

/** Maps voice confirmations/cancellations to boolean decisions. */
const CONFIRM_GRAMMAR: Record<string, boolean> = {
  yes: true, yeah: true, yep: true, yup: true,
  save: true, "save it": true,
  run: true, "run it": true,
  deploy: true, "deploy it": true,
  confirm: true, approved: true, "go ahead": true, go: true, do: true,
  no: false, nope: false, nah: false,
  hold: false, "hold on": false, "not yet": false,
  cancel: false, stop: false, wait: false, "never mind": false,
};

/** Check if a transcript matches a confirm/cancel grammar phrase.
 *  Returns `true` (confirm), `false` (cancel), or `null` (no match). */
export function matchConfirmGrammar(transcript: string): boolean | null {
  const t = transcript.toLowerCase().trim();
  if (t in CONFIRM_GRAMMAR) return CONFIRM_GRAMMAR[t];
  // Check multi-word matches
  for (const [phrase, decision] of Object.entries(CONFIRM_GRAMMAR)) {
    if (t === phrase || t.startsWith(phrase + " ") || t.endsWith(" " + phrase)) {
      return decision;
    }
  }
  return null;
}

/** Maps voice commands to store actions (quiet mode, pin, etc.). */
const VOICE_ACTIONS: Record<string, string> = {
  quiet: "quietMode",
  shh: "quietMode",
  mute: "quietMode",
  "go silent": "quietMode",
  "quiet mode": "quietMode",
  "pin this": "pinWindow",
  "pin it": "pinWindow",
  "unpin": "unpinWindow",
  "unpin this": "unpinWindow",
};

/** Check if a transcript matches a voice action.
 *  Returns the action name or `null`. */
export function matchVoiceAction(transcript: string): string | null {
  const t = transcript.toLowerCase().trim();
  return VOICE_ACTIONS[t] ?? null;
}

/* ---------- Unified hold-to-talk hook ----------------------------------- */

export interface UsePushToTalkOpts {
  /** Called with the final transcript after release. */
  onTranscript?: (text: string) => void;
  /** If true, use VAD (voice activity detection) instead of push-to-talk.
   *  VAD starts listening on mount and auto-submits on silence. Default: true. */
  vadMode?: boolean;
}

export function usePushToTalk(opts: UsePushToTalkOpts = {}) {
  const cfg = useVoiceConfig();
  const setDock = useAgentStore((s) => s.setDock);
  const appendTranscript = useAgentStore((s) => s.appendTranscript);
  const clearTranscript = useAgentStore((s) => s.clearTranscript);

  const [holding, setHolding] = useState(false);
  /* Synchronous mirror of `holding` so onPress/onRelease can see the
   * current state without waiting for React to re-render. Without this
   * a fast tap (down → up in the same frame) would call onRelease
   * before React had committed onPress's setState, the closure-captured
   * `holding` would still be false, and onRelease would early-return —
   * stranding the STT session in "started but never stopped" land. */
  const holdingRef = useRef(false);
  /* Latest opts callback, so onRelease always uses the freshest one
   * without re-creating the callback identity (which would also
   * re-bind the global `.` listener in <VoiceBridge>). */
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  /* Active STT session. Set in onPress, consumed by the tail timer. */
  const sessionRef = useRef<SttSession | null>(null);
  /* Pending-release: set if the user lets go while onPress is still
   * awaiting mic permission / recorder warmup. Honoured at the tail
   * of onPress so we never strand the recording. */
  const pendingReleaseRef = useRef(false);
  /* True while a finalizeRelease is in flight, so an immediate second
   * onPress doesn't try to stomp on it. */
  const finalizingRef = useRef(false);
  /* Tail timer: when the user releases `.`, we keep the mic open for
   * a short window (TAIL_MS) before flushing. This catches trailing
   * words that landed at the same instant the user lifted their finger.
   * If they re-press during the tail, we cancel the timer and resume
   * the same session — no new mic prompt, no lost audio. */
  const tailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cfgSttRef = useRef(cfg.stt);
  cfgSttRef.current = cfg.stt;

  const TAIL_MS = 400;

  const clearTailTimer = () => {
    if (tailTimerRef.current !== null) {
      clearTimeout(tailTimerRef.current);
      tailTimerRef.current = null;
    }
  };

  /* Tear down the tail timer on unmount so we don't fire after the
   * component goes away. */
  useEffect(() => () => clearTailTimer(), []);

  const finalize = useCallback(
    async (session: SttSession) => {
      finalizingRef.current = true;
      setDock("thinking");
      let transcript = "";
      try {
        transcript = await session.stop();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[voice] STT stop failed", err);
      }
      finalizingRef.current = false;
      setDock("idle");
      if (transcript) optsRef.current.onTranscript?.(transcript);
    },
    [setDock],
  );

  const onPress = useCallback(async () => {
    // Re-press during the tail window: cancel the pending stop and
    // resume the existing session. No new mic prompt, no lost audio.
    if (tailTimerRef.current !== null && sessionRef.current) {
      clearTailTimer();
      holdingRef.current = true;
      setHolding(true);
      setDock("listening");
      return;
    }

    if (holdingRef.current) return;
    holdingRef.current = true;
    pendingReleaseRef.current = false;
    setHolding(true);
    setDock("listening");
    clearTranscript();

    const session: SttSession =
      cfgSttRef.current === "elevenlabs"
        ? makeElevenSttSession()
        : makeBrowserSttSession({
            onInterim: (text) => {
              // Pump live transcript into the store so the dock can
              // narrate it during the hold.
              clearTranscript();
              appendTranscript(text);
            },
          });

    try {
      await session.start();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[voice] mic permission failed", err);
      holdingRef.current = false;
      pendingReleaseRef.current = false;
      setHolding(false);
      setDock("idle");
      return;
    }

    sessionRef.current = session;

    // Honour any release that landed while we were awaiting start.
    if (pendingReleaseRef.current) {
      pendingReleaseRef.current = false;
      holdingRef.current = false;
      setHolding(false);
      // Even the synthetic-release path keeps the tail window so
      // someone tapping `.` and immediately speaking still gets heard.
      tailTimerRef.current = setTimeout(() => {
        tailTimerRef.current = null;
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        finalize(session);
      }, TAIL_MS);
    }
  }, [setDock, clearTranscript, appendTranscript, finalize]);

  const onRelease = useCallback(async () => {
    if (!holdingRef.current) return;

    // Recorder warmup hasn't finished yet — schedule the stop so
    // onPress's tail can pick it up.
    if (sessionRef.current === null) {
      pendingReleaseRef.current = true;
      return;
    }

    const session = sessionRef.current;
    holdingRef.current = false;
    pendingReleaseRef.current = false;
    setHolding(false);
    // Stay in dock="listening" during the tail so the user gets the
    // visual feedback that we're still capturing the last 400ms.

    clearTailTimer();
    tailTimerRef.current = setTimeout(() => {
      tailTimerRef.current = null;
      // If the session was swapped out (e.g. unmount), bail.
      if (sessionRef.current !== session) return;
      sessionRef.current = null;
      void finalize(session);
    }, TAIL_MS);
  }, [finalize]);

  return {
    holding,
    onPress,
    onRelease,
    sttProvider: cfg.stt,
    ttsProvider: cfg.tts,
  };
}

/* ---------- TTS --------------------------------------------------------- */

import { getAudioContext, getIsAudioPlaying, setGlobalPlayingCallback, playBase64Audio } from "./audio-player";

let currentAudio: HTMLAudioElement | null = null;
let cancelBrowserSpeak: (() => void) | null = null;
let currentStopFn: (() => void) | null = null;

export interface SpeakOpts {
  onStart?: () => void;
  onEnd?: () => void;
}

/** Global flag to track if TTS is currently playing */
export function isTTSPlaying(): boolean {
  return getIsAudioPlaying();
}

/** Set a callback to be notified when TTS state changes */
export function onTTSStateChange(cb: (playing: boolean) => void): void {
  setGlobalPlayingCallback(cb);
}

/** Speak `text` using the configured provider. Returns a stop fn. */
export async function speak(text: string, opts: SpeakOpts = {}): Promise<() => void> {
  console.log("[voice.ts speak] Starting speak for text:", text.substring(0, 50), "...");
  
  if (typeof window === "undefined") {
    console.log("[voice.ts speak] Window not defined (SSR), skipping");
    return () => {};
  }
  
  if (!text.trim()) {
    console.log("[voice.ts speak] Empty text, skipping");
    return () => {};
  }

  // Cancel anything currently speaking first.
  console.log("[voice.ts speak] Cancelling previous speech");
  cancelSpeak();

  const cfg = await loadVoiceConfig();
  console.log("[voice.ts speak] Voice config loaded:", cfg);
  
  if (cfg.tts === "elevenlabs" || cfg.tts === "cartesia") {
    console.log("[voice.ts speak] Using server TTS provider:", cfg.tts);
    try {
      console.log("[voice.ts speak] Fetching /api/tts...");
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      
      console.log("[voice.ts speak] /api/tts response status:", res.status);
      
      if (!res.ok) {
        const errorText = await res.text().catch(() => "unknown error");
        console.error("[voice.ts speak] TTS request failed:", res.status, errorText);
        throw new Error(`tts ${res.status}: ${errorText}`);
      }
      
      console.log("[voice.ts speak] Getting blob from response...");
      const blob = await res.blob();
      console.log("[voice.ts speak] Received blob:", blob.size, "bytes, type:", blob.type);
      
      if (blob.size === 0) {
        console.error("[voice.ts speak] Received empty audio blob");
        throw new Error("Empty audio response");
      }

      // Use AudioContext if available for better control, fallback to HTML5
      const audioCtx = getAudioContext();
      if (audioCtx) {
        console.log("[voice.ts speak] Using Web Audio API");
        try {
          const arrayBuffer = await blob.arrayBuffer();
          console.log("[voice.ts speak] Decoding audio data...");
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          console.log("[voice.ts speak] Decoded audio buffer, duration:", audioBuffer.duration.toFixed(2), "seconds");
          
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          
          source.onended = () => {
            console.log("[voice.ts speak] Web Audio playback ended");
            opts.onEnd?.();
          };

          console.log("[voice.ts speak] Starting Web Audio playback...");
          source.start(0);
          opts.onStart?.();
          
          currentStopFn = () => {
            try {
              source.stop();
              source.disconnect();
            } catch {
              // Ignore
            }
            opts.onEnd?.();
          };
          
          return currentStopFn;
        } catch (decodeError) {
          console.warn("[voice.ts speak] Web Audio decode failed, falling back to HTML5:", decodeError);
          // Fall through to HTML5 Audio
        }
      }

      // HTML5 Audio fallback
      console.log("[voice.ts speak] Using HTML5 Audio");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      
      audio.onplay = () => {
        console.log("[voice.ts speak] HTML5 Audio started playing");
        opts.onStart?.();
      };
      
      audio.onended = () => {
        console.log("[voice.ts speak] HTML5 Audio playback ended");
        opts.onEnd?.();
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
      };
      
      audio.onerror = (e) => {
        console.error("[voice.ts speak] HTML5 Audio error:", e);
        opts.onEnd?.();
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
      };
      
      console.log("[voice.ts speak] Calling audio.play()...");
      await audio.play();
      console.log("[voice.ts speak] audio.play() returned successfully");
      
      return () => {
        console.log("[voice.ts speak] Stop function called");
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          /* ignore */
        }
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        opts.onEnd?.();
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[voice.ts speak] /api/tts failed; falling back to browser", err);
    }
  } else {
    console.log("[voice.ts speak] Server TTS not available, using browser TTS");
  }

  // Browser fallback
  if ("speechSynthesis" in window) {
    console.log("[voice.ts speak] Using browser speech synthesis");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.98;
    utterance.pitch = 1;
    utterance.onstart = () => {
      console.log("[voice.ts speak] Browser TTS started");
      opts.onStart?.();
    };
    utterance.onend = () => {
      console.log("[voice.ts speak] Browser TTS ended");
      opts.onEnd?.();
      cancelBrowserSpeak = null;
    };
    cancelBrowserSpeak = () => {
      window.speechSynthesis.cancel();
      cancelBrowserSpeak = null;
      opts.onEnd?.();
    };
    // small kick-off so the first utterance plays reliably after async work
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    console.log("[voice.ts speak] Browser TTS speak() called");
    return () => cancelSpeak();
  }
  
  console.warn("[voice.ts speak] No TTS available");
  // No TTS available; trigger end so callers can finish their UI.
  opts.onEnd?.();
  return () => {};
}

export function cancelSpeak(): void {
  console.log("[voice.ts cancelSpeak] Cancelling all speech");
  
  if (currentAudio) {
    console.log("[voice.ts cancelSpeak] Stopping current HTML5 audio");
    try {
      currentAudio.pause();
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  
  if (currentStopFn) {
    console.log("[voice.ts cancelSpeak] Calling current stop function");
    currentStopFn();
    currentStopFn = null;
  }
  
  if (cancelBrowserSpeak) {
    console.log("[voice.ts cancelSpeak] Stopping browser TTS");
    cancelBrowserSpeak();
    cancelBrowserSpeak = null;
  } else if (
    typeof window !== "undefined" &&
    "speechSynthesis" in window
  ) {
    console.log("[voice.ts cancelSpeak] Cancelling speech synthesis");
    window.speechSynthesis.cancel();
  }
  
  console.log("[voice.ts cancelSpeak] All speech cancelled");
}

/* ---------- Backward-compat hook used by existing components ------------ */

export function useWebSpeech() {
  const ptt = usePushToTalk();
  return {
    supported: true,
    listening: ptt.holding,
    start: ptt.onPress,
    stop: ptt.onRelease,
  };
}

/* ---------- Conversation VAD with Echo Cancellation ----------------------- */

export interface UseConversationVADOpts {
  /** Called when user speech is detected and transcribed */
  onTranscript: (text: string) => void;
  /** Called when VAD detects speech start */
  onSpeechStart?: () => void;
  /** Called when VAD detects speech end (silence) */
  onSpeechEnd?: () => void;
  /** Called with base64 audio chunks for streaming (real-time streaming to ElevenLabs) */
  onAudioChunk?: (base64Audio: string) => void;
  /** Whether VAD is active */
  enabled: boolean;
  /** Delay after TTS finishes before re-enabling VAD (ms) */
  postSpeakDelay?: number;
}

export function useConversationVAD(opts: UseConversationVADOpts) {
  const { onTranscript, onSpeechStart, onSpeechEnd, onAudioChunk, enabled, postSpeakDelay = 800 } = opts;
  const cfg = useVoiceConfig();

  const isAgentSpeaking = useAgentStore((s) => s.isAgentSpeaking);
  const setIsAgentSpeaking = useAgentStore((s) => s.setIsAgentSpeaking);
  const setDock = useAgentStore((s) => s.setDock);
  const appendTranscript = useAgentStore((s) => s.appendTranscript);
  const clearTranscript = useAgentStore((s) => s.clearTranscript);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // MediaRecorder for streaming audio chunks
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postSpeakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<SttSession | null>(null);
  const vadActiveRef = useRef(false);
  const recordingStartTimeRef = useRef<number>(0);

  const SPEECH_THRESHOLD = 0.15;
  const SILENCE_DURATION = 1200; // ms of silence before submitting
  const BUFFER_SIZE = 2048;

  // Stop VAD when agent is speaking
  useEffect(() => {
    if (isAgentSpeaking && vadActiveRef.current) {
      pauseVAD();
    } else if (!isAgentSpeaking && enabled && !postSpeakTimerRef.current) {
      // Small delay before resuming after TTS
      postSpeakTimerRef.current = setTimeout(() => {
        resumeVAD();
        postSpeakTimerRef.current = null;
      }, postSpeakDelay);
    }

    return () => {
      if (postSpeakTimerRef.current) {
        clearTimeout(postSpeakTimerRef.current);
        postSpeakTimerRef.current = null;
      }
    };
  }, [isAgentSpeaking, enabled, postSpeakDelay]);

  const pauseVAD = useCallback(() => {
    vadActiveRef.current = false;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    // Don't stop the session, just pause processing
  }, []);

  const resumeVAD = useCallback(() => {
    if (enabled && !isAgentSpeaking) {
      vadActiveRef.current = true;
    }
  }, [enabled, isAgentSpeaking]);

  const finalizeTranscription = useCallback(async () => {
    if (!sessionRef.current) return;

    isSpeakingRef.current = false;
    onSpeechEnd?.();
    setDock("thinking");

    let transcript = "";
    try {
      transcript = await sessionRef.current.stop();
    } catch (err) {
      console.warn("[VAD] STT stop failed", err);
    }

    sessionRef.current = null;

    if (transcript.trim()) {
      onTranscript(transcript.trim());
    }

    // Restart listening if still enabled
    if (enabled && !isAgentSpeaking) {
      setTimeout(() => startListening(), 100);
    } else {
      setDock(enabled ? "conversing" : "idle");
    }
  }, [onTranscript, onSpeechEnd, setDock, enabled, isAgentSpeaking]);

  const startListening = useCallback(async () => {
    if (!enabled || isAgentSpeaking || sessionRef.current) return;

    try {
      // Request microphone with echo cancellation
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        }
      });

      mediaStreamRef.current = stream;

      // Create audio context for VAD processing
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up MediaRecorder for streaming audio chunks to ElevenLabs
      if (onAudioChunk) {
        const mimeType = getBestMimeType();
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = async (event) => {
          if (event.data && event.data.size > 0) {
            // Convert chunk to base64 and emit for streaming
            try {
              const base64Chunk = await blobToBase64(event.data);
              onAudioChunk(base64Chunk);
            } catch (err) {
              console.warn('[VAD] Failed to convert audio chunk to base64:', err);
            }
          }
        };

        recorder.onstart = () => {
          recordingStartTimeRef.current = Date.now();
        };

        // Start recording with small time slices for real-time streaming
        recorder.start(250); // 250ms chunks for low latency
      }

      // Create STT session (for transcript finalization)
      const session: SttSession =
        cfg.stt === "elevenlabs"
          ? makeElevenSttSession()
          : makeBrowserSttSession({
              onInterim: (text) => {
                clearTranscript();
                appendTranscript(text);
              },
            });

      await session.start();
      sessionRef.current = session;

      isListeningRef.current = true;
      vadActiveRef.current = true;
      setDock("conversing");

      // Start VAD loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkAudioLevel = () => {
        if (!vadActiveRef.current || !isListeningRef.current) return;

        analyser.getByteFrequencyData(dataArray);

        // Calculate RMS volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length) / 255;

        if (rms > SPEECH_THRESHOLD && !isSpeakingRef.current) {
          // Speech detected
          isSpeakingRef.current = true;
          onSpeechStart?.();
          setDock("listening");

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (rms <= SPEECH_THRESHOLD && isSpeakingRef.current) {
          // Potential silence - start timer
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              finalizeTranscription();
            }, SILENCE_DURATION);
          }
        } else if (rms > SPEECH_THRESHOLD && isSpeakingRef.current && silenceTimerRef.current) {
          // Still speaking, cancel silence timer
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        requestAnimationFrame(checkAudioLevel);
      };

      checkAudioLevel();

    } catch (err) {
      console.warn("[VAD] Failed to start", err);
      setDock("idle");
    }
  }, [enabled, isAgentSpeaking, cfg.stt, clearTranscript, appendTranscript, setDock, onSpeechStart, onAudioChunk, finalizeTranscription]);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    vadActiveRef.current = false;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Stop MediaRecorder if active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore already stopped errors
      }
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];

    if (sessionRef.current) {
      void sessionRef.current.stop();
      sessionRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current?.state !== "closed") {
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    }

    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    setDock("idle");
  }, [setDock]);

  // Start/stop based on enabled state
  useEffect(() => {
    if (enabled) {
      void startListening();
    } else {
      stopListening();
    }

    return () => {
      stopListening();
    };
  }, [enabled, startListening, stopListening]);

  return {
    isListening: isListeningRef.current,
    isSpeaking: isSpeakingRef.current,
  };
}
