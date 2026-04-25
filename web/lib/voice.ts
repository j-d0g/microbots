"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "./store";

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

/* ---------- Unified hold-to-talk hook ----------------------------------- */

export interface UsePushToTalkOpts {
  /** Called with the final transcript after release. */
  onTranscript?: (text: string) => void;
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

  /* Active STT session. Set in onPress, consumed in onRelease. */
  const sessionRef = useRef<SttSession | null>(null);
  /* Pending-release: set if the user lets go while onPress is still
   * awaiting mic permission / recorder warmup. Honoured at the tail
   * of onPress so we never strand the recording. */
  const pendingReleaseRef = useRef(false);
  /* True while a finalizeRelease is in flight, so an immediate second
   * onPress doesn't try to stomp on it. */
  const finalizingRef = useRef(false);

  const cfgSttRef = useRef(cfg.stt);
  cfgSttRef.current = cfg.stt;

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
      sessionRef.current = null;
      await finalize(session);
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

    const s = sessionRef.current;
    sessionRef.current = null;
    holdingRef.current = false;
    pendingReleaseRef.current = false;
    setHolding(false);
    await finalize(s);
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

let currentAudio: HTMLAudioElement | null = null;
let cancelBrowserSpeak: (() => void) | null = null;

export interface SpeakOpts {
  onStart?: () => void;
  onEnd?: () => void;
}

/** Speak `text` using the configured provider. Returns a stop fn. */
export async function speak(text: string, opts: SpeakOpts = {}): Promise<() => void> {
  if (typeof window === "undefined" || !text.trim()) return () => {};

  // Cancel anything currently speaking first.
  cancelSpeak();

  const cfg = await loadVoiceConfig();
  if (cfg.tts === "elevenlabs" || cfg.tts === "cartesia") {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onplay = () => opts.onStart?.();
      audio.onended = () => {
        opts.onEnd?.();
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
      };
      audio.onerror = () => {
        opts.onEnd?.();
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
      };
      void audio.play();
      return () => {
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
      console.warn("[voice] /api/tts failed; falling back to browser", err);
    }
  }

  // Browser fallback
  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.98;
    utterance.pitch = 1;
    utterance.onstart = () => opts.onStart?.();
    utterance.onend = () => {
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
    return () => cancelSpeak();
  }
  // No TTS available; trigger end so callers can finish their UI.
  opts.onEnd?.();
  return () => {};
}

export function cancelSpeak(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (cancelBrowserSpeak) {
    cancelBrowserSpeak();
    cancelBrowserSpeak = null;
  } else if (
    typeof window !== "undefined" &&
    "speechSynthesis" in window
  ) {
    window.speechSynthesis.cancel();
  }
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
