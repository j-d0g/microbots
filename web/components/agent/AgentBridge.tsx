"use client";

import { useEffect } from "react";
import { connectAgentStream } from "@/lib/agent-client";
import { useAgentStore } from "@/lib/store";

/** Mounts once in the shell. Opens the SSE agent stream. */
export function AgentBridge() {
  const openRoom = useAgentStore((s) => s.openRoom);
  const modals = useAgentStore((s) => s.modals);

  // Auto-open brief if no modals yet and already onboarded
  useEffect(() => {
    if (modals.length === 0) {
      openRoom("brief");
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open SSE stream for the lifetime of the shell
  useEffect(() => {
    const ctrl = new AbortController();
    connectAgentStream(ctrl.signal).catch(() => {
      /* stream will be retried as needed */
    });
    return () => ctrl.abort();
  }, []);

  return null;
}
