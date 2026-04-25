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

/* ---------- Web Speech (native) ----------------------------------------- */

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
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const SR =
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  return (SR as new () => SpeechRecognitionLike) ?? null;
}

/* ---------- ElevenLabs (MediaRecorder ↑ /api/stt) ----------------------- */

async function recordAndTranscribe(): Promise<{
  start: () => Promise<void>;
  stop: () => Promise<string>;
}> {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  const chunks: BlobPart[] = [];
  let stopped: Promise<void> | null = null;

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
      recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      stopped = new Promise<void>((res) => {
        recorder!.onstop = () => res();
      });
      recorder.start(250);
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

      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
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
  const browserRecRef = useRef<SpeechRecognitionLike | null>(null);
  const browserTextRef = useRef("");
  const elevenSessionRef = useRef<{
    stop: () => Promise<string>;
  } | null>(null);

  const onPress = useCallback(async () => {
    if (holding) return;
    setHolding(true);
    setDock("listening");
    clearTranscript();
    browserTextRef.current = "";

    if (cfg.stt === "elevenlabs") {
      try {
        const session = await recordAndTranscribe();
        await session.start();
        elevenSessionRef.current = { stop: session.stop };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[voice] mic permission failed", err);
        setHolding(false);
        setDock("idle");
      }
      return;
    }

    // browser fallback (Web Speech API)
    const SR = getSpeechRecognition();
    if (!SR) {
      // unsupported browser — short fake transcript so the UI still flows
      browserTextRef.current =
        "every morning I end up triaging the same product bugs from Slack into Linear ";
      appendTranscript(browserTextRef.current);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript + " ";
        }
      }
      if (finalText) {
        browserTextRef.current += finalText;
        appendTranscript(finalText);
      }
    };
    rec.onerror = () => {
      setHolding(false);
      setDock("idle");
    };
    rec.onend = () => {
      // handled in onRelease
    };
    rec.start();
    browserRecRef.current = rec;
  }, [holding, cfg.stt, setDock, clearTranscript, appendTranscript]);

  const onRelease = useCallback(async () => {
    if (!holding) return;
    setHolding(false);

    let transcript = "";

    if (cfg.stt === "elevenlabs" && elevenSessionRef.current) {
      setDock("thinking");
      try {
        transcript = await elevenSessionRef.current.stop();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[voice] STT stop failed", err);
      }
      elevenSessionRef.current = null;
    } else {
      const rec = browserRecRef.current;
      if (rec) {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
        browserRecRef.current = null;
      }
      transcript = browserTextRef.current.trim();
      setDock("thinking");
    }

    setDock("idle");
    if (transcript) opts.onTranscript?.(transcript);
  }, [holding, cfg.stt, opts, setDock]);

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
