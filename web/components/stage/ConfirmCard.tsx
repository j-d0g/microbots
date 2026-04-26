"use client";

/**
 * ConfirmCard — modal confirm gate for destructive tool calls.
 *
 * Renders at bottom-centre with backdrop-blur. Shows question + action/hold buttons.
 * Voice accepts "yes / save / run / deploy" -> confirm, "no / hold / not yet" -> cancel.
 * 60s timeout -> auto-cancel + toast.
 * Stacks in bottom-right if multiple pending.
 */

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAgentStore, type ConfirmIntent } from "@/lib/store";
import { cn } from "@/lib/cn";

const TIMEOUT_MS = 60_000;

function ConfirmItem({ intent, index }: { intent: ConfirmIntent; index: number }) {
  const resolveConfirm = useAgentStore((s) => s.resolveConfirm);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-cancel after 60s
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      resolveConfirm(intent.id, false);
    }, TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [intent.id, resolveConfirm]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ zIndex: 1001 + index }}
      className={cn(
        "rounded-lg border border-accent-indigo/30",
        "bg-paper-1/95 backdrop-blur-md",
        "shadow-[0_0_0_1px_rgba(46,58,140,0.08),0_4px_24px_rgba(46,58,140,0.12)]",
        "p-4 w-[min(420px,90vw)]",
        index > 0 && "mt-2",
      )}
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-accent-indigo mb-2">
        confirm &middot; {intent.toolName}
      </p>
      <p className="font-mono text-[12px] text-ink-90 leading-relaxed mb-3">
        {intent.description}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => resolveConfirm(intent.id, true)}
          className={cn(
            "flex-1 font-mono text-[11px] px-3 py-2 rounded",
            "bg-accent-indigo text-white",
            "hover:bg-accent-indigo/90 transition-colors duration-150",
          )}
        >
          confirm
        </button>
        <button
          type="button"
          onClick={() => resolveConfirm(intent.id, false)}
          className={cn(
            "flex-1 font-mono text-[11px] px-3 py-2 rounded",
            "border border-rule text-ink-60",
            "hover:bg-paper-2 transition-colors duration-150",
          )}
        >
          hold
        </button>
      </div>
    </motion.div>
  );
}

export function ConfirmCardStack() {
  const confirmQueue = useAgentStore((s) => s.confirmQueue);

  if (confirmQueue.length === 0) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center">
      <AnimatePresence mode="popLayout">
        {confirmQueue.map((intent, i) => (
          <ConfirmItem key={intent.id} intent={intent} index={i} />
        ))}
      </AnimatePresence>
    </div>
  );
}
