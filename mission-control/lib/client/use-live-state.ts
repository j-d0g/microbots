"use client";

import { useEffect } from "react";
import type { BusEvent } from "@/lib/types";
import { useMissionStore } from "./store";

export function useLiveState(): void {
  const applyEvent = useMissionStore((state) => state.applyEvent);
  const setConnected = useMissionStore((state) => state.setConnected);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => setConnected(true);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as BusEvent;
        applyEvent(event);
        if (event.type === "snapshot") setConnected(true);
      } catch {
        // Ignore malformed frames and keep the browser's reconnect loop alive.
      }
    };
    source.onerror = () => setConnected(false);
    return () => {
      source.close();
      setConnected(false);
    };
  }, [applyEvent, setConnected]);
}
