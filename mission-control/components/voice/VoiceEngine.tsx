"use client";
import { useEffect } from "react";
import { useMC } from "@/lib/client/hooks";
import { handleSpeak } from "@/lib/client/voice";

/** Drains speak requests from the live stream into the voice layer. */
export function VoiceEngine() {
  const n = useMC((s) => s.speakQueue.length);
  useEffect(() => {
    if (!n) return;
    const req = useMC.getState().shiftSpeak();
    if (req) handleSpeak(req);
  }, [n]);
  return null;
}
