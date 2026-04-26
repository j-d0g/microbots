"use client";

/**
 * FloatingDock — original-style bottom bar with inline narration.
 *
 * Design principles:
 *   - h-14 rounded-lg bar, bg-paper-1/95, subtle shadow (original style)
 *   - VoiceDot on the left, inline narration text in the middle
 *   - When idle: subtle hint; when active: live text flows across
 *   - No room icons — those were removed for the windowed setting
 */

import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { VoiceDot } from "./VoiceDot";
import { cn } from "@/lib/cn";

type DockState = ReturnType<typeof useAgentStore.getState>["dock"];

export function FloatingDock() {
  const dock = useAgentStore((s) => s.dock);
  const status = useAgentStore((s) => s.agentStatus);
  const reply = useAgentStore((s) => s.agentReply);
  const transcript = useAgentStore((s) => s.transcript);
  const toggleUiMode = useAgentStore((s) => s.toggleUiMode);

  const hidden = dock === "hidden";

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

  const isSpeaking = narrationKind === "speaking";
  const isListening = narrationKind === "listening";

  // Track when a reply freshly lands in the dock (CommandBar just closed)
  const [justLanded, setJustLanded] = useState(false);
  const prevReplyLen = useRef(0);
  useEffect(() => {
    if (reply.length > 0 && prevReplyLen.current === 0 && !useAgentStore.getState().commandOpen) {
      setJustLanded(true);
      const t = window.setTimeout(() => setJustLanded(false), 800);
      return () => window.clearTimeout(t);
    }
    prevReplyLen.current = reply.length;
  }, [reply.length]);

  // Determine what text to show
  const displayText = narrationText
    ? isListening
      ? transcript
      : reply
    : status || dockHint(dock);

  const textColor = narrationText
    ? isSpeaking
      ? "text-ink-90"
      : "text-ink-60"
    : "text-ink-30";

  return (
    <motion.nav
      aria-label="agent dock"
      initial={{ y: 12, opacity: 0 }}
      animate={{
        y: hidden ? 12 : 0,
        opacity: hidden ? 0.55 : 1,
      }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "fixed bottom-8 left-1/2 -translate-x-1/2 z-[40]",
        "flex items-center gap-4",
        "h-14 px-4 rounded-lg bg-paper-1/95 backdrop-blur",
        "border border-rule shadow-[0_1px_0_rgba(0,0,0,0.04)]",
        justLanded && "shadow-[0_1px_0_rgba(46,58,140,0.12)]",
        "transition-shadow duration-500",
        "w-[min(90vw,800px)]",
      )}
    >
      {/* Voice indicator */}
      <VoiceDot />

      {/* Inline narration / status text */}
      <div className="relative flex-1 min-w-[200px] max-w-[600px] overflow-hidden">
        {/* Fade masks */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-paper-1/95 to-transparent z-10" />

        <motion.div
          key={displayText}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "whitespace-nowrap text-xs font-mono",
            textColor,
          )}
          style={{
            animation: displayText && displayText.length > 60
              ? "marquee 20s linear infinite"
              : "none",
          }}
          data-testid="dock-text"
        >
          {displayText}
        </motion.div>
      </div>

      {/* Chat mode toggle */}
      <button
        type="button"
        onClick={toggleUiMode}
        aria-label="switch to chat mode"
        title="chat mode"
        data-testid="dock-chat-mode"
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          "text-ink-35 hover:text-ink-90 hover:bg-paper-2",
          "transition-colors duration-200",
          "ml-22",
        )}
      >
        <MessageSquare size={14} strokeWidth={1.5} />
      </button>
    </motion.nav>
  );
}

function dockHint(dock: DockState): string {
  switch (dock) {
    case "listening":
      return "listening...";
    case "thinking":
      return "thinking...";
    case "speaking":
      return "speaking...";
    case "hidden":
      return "";
    default:
      return "/ to type · hold dot to talk";
  }
}
