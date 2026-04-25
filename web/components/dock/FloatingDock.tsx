"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sunrise,
  Network,
  ListOrdered,
  Boxes,
  Mic,
  BookOpen,
  Settings2,
} from "lucide-react";
import { useAgentStore, type RoomName } from "@/lib/store";
import { VoiceDot } from "./VoiceDot";
import { CommandKey } from "./CommandKey";
import { cn } from "@/lib/cn";

const ROOMS: Array<{ room: RoomName; href: string; label: string; Icon: typeof Sunrise }> = [
  { room: "brief", href: "/brief", label: "Brief", Icon: Sunrise },
  { room: "graph", href: "/graph", label: "Graph", Icon: Network },
  { room: "workflow", href: "/workflow", label: "Workflows", Icon: ListOrdered },
  { room: "stack", href: "/stack", label: "Stack", Icon: Boxes },
  { room: "waffle", href: "/waffle", label: "Waffle", Icon: Mic },
  { room: "playbooks", href: "/playbooks", label: "Playbooks", Icon: BookOpen },
  { room: "settings", href: "/settings", label: "Settings", Icon: Settings2 },
];

export function FloatingDock() {
  const room = useAgentStore((s) => s.room);
  const dock = useAgentStore((s) => s.dock);
  const status = useAgentStore((s) => s.agentStatus);

  const hidden = dock === "hidden";

  return (
    <AnimatePresence>
      <motion.nav
        aria-label="agent dock"
        initial={{ y: 12, opacity: 0 }}
        animate={{
          y: hidden ? 12 : 0,
          opacity: hidden ? 0.55 : 1,
        }}
        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        className={cn(
          "fixed bottom-8 left-1/2 -translate-x-1/2 z-50",
          "flex items-center gap-4",
          "h-14 px-4 rounded-lg bg-paper-1/95 backdrop-blur",
          "border border-rule shadow-[0_1px_0_rgba(0,0,0,0.04)]",
        )}
      >
        <VoiceDot />
        <CommandKey />

        <div className="flex min-w-[180px] max-w-[260px] items-center">
          <span className="truncate text-xs text-ink-60 font-mono">
            {status || dockPlaceholder(dock)}
          </span>
        </div>

        <div className="h-6 w-px bg-rule" aria-hidden />

        <ul className="flex items-center gap-1">
          {ROOMS.map(({ room: r, href, label, Icon }) => {
            const active = r === room;
            return (
              <li key={r}>
                <Link
                  href={href as "/brief"}
                  aria-label={label}
                  title={label}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-sm",
                    "transition-colors duration-200",
                    active
                      ? "text-ink-90 bg-paper-2"
                      : "text-ink-35 hover:text-ink-60",
                  )}
                >
                  <Icon size={16} strokeWidth={1.5} />
                </Link>
              </li>
            );
          })}
        </ul>
      </motion.nav>
    </AnimatePresence>
  );
}

function dockPlaceholder(dock: ReturnType<typeof useAgentStore.getState>["dock"]) {
  switch (dock) {
    case "listening":
      return "listening…";
    case "thinking":
      return "thinking…";
    case "speaking":
      return "speaking…";
    case "hidden":
      return "";
    default:
      return "press / to type · hold dot to talk";
  }
}
