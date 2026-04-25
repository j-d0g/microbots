"use client";

import { useEffect } from "react";
import { connectAgentStream } from "@/lib/agent-client";
import { useAgentStore } from "@/lib/store";

/** Mounts once in the shell. Opens the SSE agent stream. */
export function AgentBridge() {
  useEffect(() => {
    const s = useAgentStore.getState();
    if (s.windows.length === 0) {
      s.openWindow("brief");
    }
    // Expose store for Playwright/testing in dev. No-op in prod.
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      (window as unknown as { __store: typeof useAgentStore }).__store = useAgentStore;
    }
  }, []);

  useEffect(() => {
    // Skip the initial SSE connect -- no empty-query call on mount.
    // The agent stream is triggered by user queries via the command bar.
  }, []);

  return null;
}
