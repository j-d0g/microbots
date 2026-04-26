"use client";

/**
 * Dock telemetry strip — chronological tool tape.
 *
 * A second mono line beneath the dock narration. Prints the tool calls
 * the agent just made:
 *
 *   agent · how's slack looking?
 *          · run_code(py) · search_memory(slack) · done
 *
 * Driven by `recentActions` from the store (populated by agent.tool.start
 * / agent.tool.done SSE events). Raw tool names, arg values dimmed.
 * Lingers 2.5s after reply.done, then fades. Capped at last 6 calls.
 *
 * Plan reference: §3.1
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

/** Max tool calls to show in the strip. */
const MAX_CALLS = 6;
/** How long the strip lingers after the agent finishes. */
const LINGER_MS = 2500;

export function TelemetryStrip() {
  const actions = useAgentStore((s) => s.recentActions);
  const dock = useAgentStore((s) => s.dock);

  const [visible, setVisible] = useState(false);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show strip when there are actions and agent is active
  useEffect(() => {
    if (actions.length > 0) {
      setVisible(true);
      if (lingerRef.current) clearTimeout(lingerRef.current);
    }
  }, [actions.length]);

  // Start linger timer when agent goes idle
  useEffect(() => {
    if (dock === "idle" && visible && actions.length > 0) {
      lingerRef.current = setTimeout(() => setVisible(false), LINGER_MS);
      return () => {
        if (lingerRef.current) clearTimeout(lingerRef.current);
      };
    }
  }, [dock, visible, actions.length]);

  const recent = actions.slice(-MAX_CALLS);

  if (!visible || recent.length === 0) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          className={cn(
            "fixed bottom-[5.5rem] left-1/2 -translate-x-1/2 z-[39]",
            "flex items-center gap-1.5",
            "h-6 px-3 rounded-md",
            "bg-paper-1/80 backdrop-blur-sm",
            "border border-rule/50",
            "w-[min(90vw,800px)]",
            "overflow-hidden",
          )}
        >
          <span className="text-[10px] font-mono text-ink-35 shrink-0">
            agent
          </span>
          <span className="text-[10px] font-mono text-ink-35 shrink-0">·</span>
          <div className="flex items-center gap-1 overflow-hidden">
            {recent.map((action, i) => (
              <span key={`${action.tool}-${action.t}-${i}`} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && (
                  <span className="text-[10px] font-mono text-ink-35">·</span>
                )}
                <span className="text-[10px] font-mono text-ink-60">
                  {action.tool}
                </span>
                {Object.keys(action.args).length > 0 && (
                  <span className="text-[10px] font-mono text-ink-35">
                    ({formatArgs(action.args)})
                  </span>
                )}
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  // Show first arg value only, truncated
  const [, val] = entries[0];
  const s = typeof val === "string" ? val : JSON.stringify(val);
  return s.length > 20 ? s.slice(0, 20) + "..." : s;
}
