"use client";

import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "./store";

/** Push-to-talk hook. In v1 this is a stub:
 *  - If NEXT_PUBLIC_MOCK_AGENT is truthy or no Deepgram key is minted, the
 *    hook fakes an ink-transcript that "sets in" while held.
 *  - Wire to Deepgram via /api/deepgram/token in Phase 6.
 */
export function usePushToTalk() {
  const [holding, setHolding] = useState(false);
  const setDock = useAgentStore((s) => s.setDock);
  const appendTranscript = useAgentStore((s) => s.appendTranscript);
  const clearTranscript = useAgentStore((s) => s.clearTranscript);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!holding) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    setDock("listening");
    clearTranscript();
    // Deterministic fake transcript — placeholder for Deepgram.
    const words =
      "every morning I end up triaging the same product bugs from Slack into Linear it's boring ".split(
        " ",
      );
    let i = 0;
    intervalRef.current = setInterval(() => {
      if (i >= words.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      appendTranscript(words[i] + " ");
      i += 1;
    }, 180);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [holding, setDock, appendTranscript, clearTranscript]);

  return {
    holding,
    onPress: () => setHolding(true),
    onRelease: () => {
      setHolding(false);
      setDock("thinking");
      setTimeout(() => setDock("idle"), 900);
    },
  };
}
