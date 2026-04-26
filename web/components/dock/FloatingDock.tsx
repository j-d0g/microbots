"use client";

/**
 * FloatingDock — agent-solo windowed mode.
 *
 *   - The room-icon strip is GONE. Navigation in windowed mode is
 *     agent-driven; the user opens windows by talking/typing, not by
 *     tapping icons.
 *   - The narration panel above the core row is now the streaming
 *     reply surface. It expands to host `agentReply` chunks during a
 *     speak cycle and the live transcript while listening.
 *   - The dock is slightly taller (h-16 vs h-14) and the narration
 *     scrolls internally up to ~38vh so longer replies stay readable
 *     without pushing the canvas around.
 *   - CommandBar (spotlight) is still the input surface — `/` opens
 *     it. The dock is read-only here.
 *   - The chat-mode toggle remains; clicking it switches uiMode and
 *     the page swaps to ChatLayout.
 */

import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { useAgentStore } from "@/lib/store";
import { VoiceDot } from "./VoiceDot";
import { CommandKey } from "./CommandKey";
import { cn } from "@/lib/cn";

const DOCK_SPRING = {
  type: "spring",
  stiffness: 360,
  damping: 30,
  mass: 0.6,
} as const;

type DockState = ReturnType<typeof useAgentStore.getState>["dock"];

export function FloatingDock() {
  const dock = useAgentStore((s) => s.dock);
  const status = useAgentStore((s) => s.agentStatus);
  const reply = useAgentStore((s) => s.agentReply);
  const transcript = useAgentStore((s) => s.transcript);
  const toggleUiMode = useAgentStore((s) => s.toggleUiMode);

  const hidden = dock === "hidden";

  /* Narration: prefer the live agent reply (streaming or just-finished)
   *  over the listening transcript. We surface BOTH the speaking phase
   *  and any post-speak afterglow where reply has content but the dock
   *  has already returned to idle — that prevents the message popping
   *  away the moment the model emits "reply.done". */
  const hasReply = reply.trim().length > 0;
  const hasTranscript = transcript.trim().length > 0;

  const narrationKind: "speaking" | "listening" | null =
    hasReply && (dock === "speaking" || dock === "thinking" || dock === "idle")
      ? "speaking"
      : dock === "listening" && hasTranscript
        ? "listening"
        : null;

  const narrationText =
    narrationKind === "speaking"
      ? reply
      : narrationKind === "listening"
        ? transcript
        : null;

  return (
    <motion.div
      aria-label="agent dock"
      role="region"
      data-testid="dock"
      data-state={dock}
      initial={{ y: 12, opacity: 0 }}
      animate={{
        y: hidden ? 12 : 0,
        opacity: hidden ? 0.55 : 1,
      }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-[40]",
        "flex w-auto max-w-[min(92vw,720px)] flex-col",
      )}
    >
      <motion.div
        layout
        transition={DOCK_SPRING}
        className={cn(
          "relative flex flex-col overflow-hidden rounded-2xl",
          "bg-paper-1/85 backdrop-blur-xl",
          "border border-rule",
          "shadow-[0_18px_40px_-22px_rgba(0,0,0,0.30),0_1px_0_rgba(0,0,0,0.04)]",
        )}
      >
        {/* Streaming-reply / live-transcript narration panel.
            Internal scroll caps at 38vh so a long reply doesn't push
            the canvas around. */}
        <AnimatePresence initial={false} mode="popLayout">
          {narrationText && (
            <motion.div
              key={narrationKind}
              layout
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={DOCK_SPRING}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  "flex items-start gap-3 border-b border-rule px-5 pt-3 pb-3",
                  "max-h-[38vh] overflow-y-auto muji-scroll",
                )}
              >
                <span
                  className={cn(
                    "mt-1 block h-1.5 w-1.5 shrink-0 rounded-full",
                    narrationKind === "speaking"
                      ? "bg-accent-indigo breathing"
                      : "bg-ink-60 breathing",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
                    {narrationKind === "speaking" ? "agent" : "you"}
                  </p>
                  <motion.p
                    key={`${narrationKind}-${narrationText.length}`}
                    initial={{ opacity: 0.85 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      "mt-1 whitespace-pre-wrap text-[14px] leading-relaxed",
                      narrationKind === "speaking"
                        ? "text-ink-90"
                        : "text-ink-60",
                    )}
                    data-testid={`dock-narration-${narrationKind}`}
                  >
                    {narrationText}
                  </motion.p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Core dock row — voice + status + chat-mode toggle. */}
        <motion.nav
          layout
          transition={DOCK_SPRING}
          className="flex h-16 items-center gap-4 px-5"
        >
          <VoiceDot />
          <CommandKey />

          <div className="flex min-w-[180px] max-w-[280px] flex-1 items-center">
            <span className="truncate text-[13px] text-ink-60 font-mono">
              {status || dockPlaceholder(dock)}
            </span>
          </div>

          <div className="h-6 w-px bg-rule" aria-hidden />

          <button
            type="button"
            onClick={toggleUiMode}
            aria-label="switch to chat mode"
            title="chat mode"
            data-testid="dock-chat-mode"
            className="flex h-9 w-9 items-center justify-center rounded-sm text-ink-35 hover:text-ink-60 transition-colors duration-200"
          >
            <MessageSquare size={14} strokeWidth={1.5} />
          </button>
        </motion.nav>
      </motion.div>
    </motion.div>
  );
}

function dockPlaceholder(dock: DockState): string {
  switch (dock) {
    case "listening":
      return "listening . to release";
    case "thinking":
      return "thinking…";
    case "speaking":
      return "speaking…";
    case "hidden":
      return "";
    default:
      return "/ to type . to talk";
  }
}
