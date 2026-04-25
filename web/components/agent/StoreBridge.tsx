"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";

/**
 * Always-mounted bridge that exposes the agent store to window in dev/test.
 * Lives outside the onboarded gate so Playwright + agent harnesses can poke
 * at the store before any room is opened.
 */
export function StoreBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __store: typeof useAgentStore }).__store =
      useAgentStore;
  }, []);
  return null;
}
