"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "./store";

/** Web Speech API hook for voice input.
 *  Uses native SpeechRecognition where available, with graceful fallback
 *  to a deterministic fake transcript for unsupported browsers. */

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
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

export function useWebSpeech() {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const setDock = useAgentStore((s) => s.setDock);
  const appendTranscript = useAgentStore((s) => s.appendTranscript);
  const clearTranscript = useAgentStore((s) => s.clearTranscript);

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const start = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      // Fallback: fake transcript
      setListening(true);
      setDock("listening");
      clearTranscript();
      const words =
        "every morning I end up triaging the same product bugs from Slack into Linear it is boring ".split(" ");
      let i = 0;
      const iv = setInterval(() => {
        if (i >= words.length) { clearInterval(iv); return; }
        appendTranscript(words[i] + " ");
        i++;
      }, 180);
      recRef.current = { stop: () => clearInterval(iv) } as unknown as SpeechRecognitionLike;
      return;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event: { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; 0: { transcript: string } } } }) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript + " ";
        }
      }
      if (finalText) {
        appendTranscript(finalText);
      }
    };

    rec.onerror = () => {
      setListening(false);
      setDock("idle");
    };

    rec.onend = () => {
      setListening(false);
    };

    clearTranscript();
    rec.start();
    recRef.current = rec;
    setListening(true);
    setDock("listening");
  }, [setDock, appendTranscript, clearTranscript]);

  const stop = useCallback(() => {
    if (recRef.current) {
      try { recRef.current.stop(); } catch { /* already stopped */ }
      recRef.current = null;
    }
    setListening(false);
    setDock("thinking");
    setTimeout(() => setDock("idle"), 900);
  }, [setDock]);

  return { supported, listening, start, stop };
}

/** TTS via Web Speech Synthesis API */
export function speak(text: string): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

/** Legacy push-to-talk hook for backward compat */
export function usePushToTalk() {
  const ws = useWebSpeech();
  return {
    holding: ws.listening,
    onPress: ws.start,
    onRelease: ws.stop,
  };
}
