"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Sunrise,
  Network,
  ListOrdered,
  Boxes,
  Mic,
  BookOpen,
  Settings2,
  LayoutGrid,
} from "lucide-react";
import { useAgentStore, type RoomKind } from "@/lib/store";
import { VoiceDot } from "./VoiceDot";
import { CommandKey } from "./CommandKey";
import { cn } from "@/lib/cn";

const ROOMS: Array<{ room: RoomKind; label: string; Icon: typeof Sunrise }> = [
  { room: "brief", label: "Brief", Icon: Sunrise },
  { room: "graph", label: "Graph", Icon: Network },
  { room: "workflow", label: "Workflows", Icon: ListOrdered },
  { room: "stack", label: "Stack", Icon: Boxes },
  { room: "waffle", label: "Waffle", Icon: Mic },
  { room: "playbooks", label: "Playbooks", Icon: BookOpen },
  { room: "settings", label: "Settings", Icon: Settings2 },
];

const DOCK_SPRING = {
  type: "spring",
  stiffness: 360,
  damping: 30,
  mass: 0.6,
} as const;

export function FloatingDock() {
  const room = useAgentStore((s) => s.room);
  const dock = useAgentStore((s) => s.dock);
  const status = useAgentStore((s) => s.agentStatus);
  const reply = useAgentStore((s) => s.agentReply);
  const transcript = useAgentStore((s) => s.transcript);
  const openWindow = useAgentStore((s) => s.openWindow);
  const restoreWindow = useAgentStore((s) => s.restoreWindow);
  const arrangeWindows = useAgentStore((s) => s.arrangeWindows);
  const windows = useAgentStore((s) => s.windows);

  const hidden = dock === "hidden";

  /* Decide what (if anything) the dock should narrate above its core row.
     Speaking → reply. Listening → live transcript. Anything else → null. */
  const narrationText =
    dock === "speaking" && reply.trim().length > 0
      ? reply
      : dock === "listening" && transcript.trim().length > 0
        ? transcript
        : null;

  const narrationKind: "speaking" | "listening" | null =
    dock === "speaking" && reply.trim().length > 0
      ? "speaking"
      : dock === "listening" && transcript.trim().length > 0
        ? "listening"
        : null;

  const handleRoomClick = (r: RoomKind) => {
    const minimized = windows.find((w) => w.kind === r && w.minimized);
    if (minimized) {
      restoreWindow(minimized.id);
    } else {
      openWindow(r);
    }
  };

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
        "flex w-auto max-w-[min(92vw,820px)] flex-col",
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
        {/* Narration panel — appears when speaking or listening with text */}
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
              <div className="flex items-start gap-3 border-b border-rule px-5 pt-3 pb-3">
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
                    initial={{ opacity: 0.8 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      "mt-1 text-[14px] leading-snug",
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

        {/* Core dock row */}
        <motion.nav
          layout
          transition={DOCK_SPRING}
          className="flex h-14 items-center gap-4 px-4"
        >
          <VoiceDot />
          <CommandKey />

          <div className="flex min-w-[140px] max-w-[220px] items-center">
            <span className="truncate text-xs text-ink-60 font-mono">
              {status || dockPlaceholder(dock)}
            </span>
          </div>

          <div className="h-6 w-px bg-rule" aria-hidden />

          <ul className="flex items-center gap-1">
            {ROOMS.map(({ room: r, label, Icon }) => {
              const winState = windows.find((w) => w.kind === r);
              const active = r === room;
              const isMinimized = winState?.minimized;

              return (
                <li key={r}>
                  <button
                    type="button"
                    onClick={() => handleRoomClick(r)}
                    aria-label={label}
                    title={label}
                    data-testid={`dock-${r}`}
                    className={cn(
                      "relative flex h-9 w-9 items-center justify-center rounded-sm",
                      "transition-colors duration-200",
                      active
                        ? "text-ink-90 bg-paper-2"
                        : "text-ink-35 hover:text-ink-60",
                    )}
                  >
                    <Icon size={16} strokeWidth={1.5} />
                    {winState && !isMinimized && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-2 rounded-full bg-ink-35" />
                    )}
                    {isMinimized && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-2 rounded-full bg-ink-35/40" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="h-6 w-px bg-rule" aria-hidden />

          <button
            type="button"
            onClick={() => arrangeWindows("grid")}
            aria-label="arrange windows"
            title="arrange (grid)"
            data-testid="dock-arrange"
            className="flex h-9 w-9 items-center justify-center rounded-sm text-ink-35 hover:text-ink-60 transition-colors duration-200"
          >
            <LayoutGrid size={14} strokeWidth={1.5} />
          </button>
        </motion.nav>
      </motion.div>
    </motion.div>
  );
}

function dockPlaceholder(dock: ReturnType<typeof useAgentStore.getState>["dock"]) {
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
