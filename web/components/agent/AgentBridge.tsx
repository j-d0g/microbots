"use client";

import { useEffect } from "react";
import { connectAgentStream } from "@/lib/agent-client";
import { useAgentStore } from "@/lib/store";

/** Mounts once in the shell. Opens the SSE agent stream. */
export function AgentBridge() {
  const openWindow = useAgentStore((s) => s.openWindow);
  const windows = useAgentStore((s) => s.windows);

  useEffect(() => {
    if (windows.length === 0) {
      openWindow("brief");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    connectAgentStream(ctrl.signal).catch(() => {
      /* stream will be retried as needed */
    });
    return () => ctrl.abort();
  }, []);

  return null;
}
