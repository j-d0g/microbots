"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Sunrise,
  Network,
  Cpu,
  Save,
  ListOrdered,
  PlayCircle,
  Search,
  Sparkles,
  Settings as SettingsIcon,
  HelpCircle,
} from "lucide-react";
import { useAgentStore, type WindowState, type WindowKind } from "@/lib/store";
import { cn } from "@/lib/cn";
import { WINDOW_LABEL, WINDOW_SIDELINE_HINT } from "./window-labels";

/**
 * A window currently sitting on the sideline.
 *
 * MUJI-minimal card: icon, label, summary line, "in stage" footer.
 * Click anywhere to bring it to centre stage. We intentionally don't
 * render the room's actual content here — at thumbnail size that ends
 * up unreadable and noisy, and force-graphs / inputs / scroll regions
 * don't survive a 50% scale gracefully. A calm card is more on-brand
 * for the paper aesthetic than a busy live preview.
 *
 * Hover treatment is gentle: the icon dot warms to indigo, the
 * "in stage" caption swaps to a "click to focus →" prompt, and the
 * card lifts 1px.
 */
export function SidelinePanel({
  win,
  side,
}: {
  win: WindowState;
  side: "left" | "right";
}) {
  const bringToFront = useAgentStore((s) => s.bringToFront);
  const [hovering, setHovering] = useState(false);

  const Icon = ICONS[win.kind] ?? Sparkles;

  return (
    <motion.button
      type="button"
      data-testid={`sideline-${win.kind}`}
      data-window-id={win.id}
      data-side={side}
      onClick={() => bringToFront(win.id)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      aria-label={`bring ${WINDOW_LABEL[win.kind]} to centre stage`}
      className={cn(
        "group absolute block h-full w-full overflow-hidden text-left",
        "rounded-xl border border-rule",
        "bg-paper-1/85 backdrop-blur-sm",
        "shadow-[0_1px_2px_rgba(0,0,0,0.02),0_8px_24px_-12px_rgba(0,0,0,0.18)]",
        "hover:bg-paper-1/95 hover:border-rule-strong",
        "transition-colors duration-200",
      )}
    >
      <div className="flex h-full flex-col p-4">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
              hovering ? "bg-accent-indigo" : "bg-ink-35",
            )}
          />
          <Icon size={12} strokeWidth={1.5} className="text-ink-60" />
          <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-60">
            {WINDOW_LABEL[win.kind] ?? win.kind}
          </span>
        </div>
        <p
          className={cn(
            "mt-2 text-[13px] leading-snug",
            "text-ink-90",
          )}
        >
          {summary(win)}
        </p>
        {win.openedBy === "agent" && (
          <span className="mt-1 font-mono text-[9px] uppercase tracking-wider text-ink-35">
            opened by agent
          </span>
        )}
        <span
          className={cn(
            "mt-auto font-mono text-[9px] uppercase tracking-wider transition-colors",
            hovering ? "text-accent-indigo" : "text-ink-35",
          )}
        >
          {hovering ? "click to focus →" : "in stage"}
        </span>
      </div>
    </motion.button>
  );
}

const ICONS: Partial<Record<WindowKind, typeof Sunrise>> = {
  run_code: Cpu,
  save_workflow: Save,
  view_workflow: ListOrdered,
  run_workflow: PlayCircle,
  list_workflows: ListOrdered,
  find_examples: Sparkles,
  search_memory: Search,
  ask_user: HelpCircle,
  graph: Network,
  settings: SettingsIcon,
};

function summary(win: WindowState): string {
  // The agent can stuff a `summary` string into the payload; honour
  // it before falling back to a generic per-kind label.
  const fromAgent =
    typeof win.payload?.summary === "string"
      ? (win.payload.summary as string)
      : null;
  return fromAgent ?? WINDOW_SIDELINE_HINT[win.kind] ?? "";
}
