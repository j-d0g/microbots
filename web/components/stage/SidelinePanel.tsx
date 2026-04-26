"use client";

import { useCallback, useMemo, useState } from "react";
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
import { ShapeButton } from "./ShapeButton";
import { MAX_LEFT_SIDELINE } from "@/lib/stage-manager";

/**
 * A window currently sitting on the sideline.
 *
 * Layout: a slim title strip at the top hosts the same shape controls
 * the centre frame uses (pin, oval, close), and the rest of the card
 * is a click-to-promote button (clicking the body brings the window
 * to centre stage). The room's live content is intentionally NOT
 * rendered at sideline size — at thumbnail scale that ends up
 * unreadable, and force-graphs / inputs / scroll regions don't
 * survive 50% scale gracefully. A calm card is more on-brand for the
 * paper aesthetic than a busy live preview.
 *
 * Per the layout spec:
 *   • pin   — visible on every sideline window. Left side: shows as
 *           active (filled triangle) and click = unpin + bringToFront.
 *           Right side: click = pin (move to left sideline). Disabled
 *           on the right when the left sideline is already full.
 *   • oval  — visible only on the RIGHT sideline. Click swaps that
 *           window with the current centre (bringToFront).
 *   • close — visible on every sideline window. Removes from the UI.
 */
export function SidelinePanel({
  win,
  side,
}: {
  win: WindowState;
  side: "left" | "right";
}) {
  const bringToFront = useAgentStore((s) => s.bringToFront);
  const closeWindow = useAgentStore((s) => s.closeWindow);
  const pinWindow = useAgentStore((s) => s.pinWindow);
  const unpinWindow = useAgentStore((s) => s.unpinWindow);
  const windows = useAgentStore((s) => s.windows);
  const pinned = win.pinned === true;

  const otherPinnedCount = useMemo(
    () => windows.filter((w) => w.pinned && w.id !== win.id).length,
    [windows, win.id],
  );
  /* Pin button refused only when self isn't already pinned AND
   * adding self would push the left sideline past its cap. An already
   * pinned card is always toggleable (the click means "unpin"). */
  const pinDisabled = !pinned && otherPinnedCount >= MAX_LEFT_SIDELINE;

  const [hovering, setHovering] = useState(false);
  const [pressing, setPressing] = useState<"pin" | "swap" | "close" | null>(
    null,
  );

  const onPin = useCallback(() => {
    if (pinned) {
      // Unpin from left sideline, then bringToFront so the user sees
      // what they just released — it lands as the new centre.
      unpinWindow(win.id);
      requestAnimationFrame(() => bringToFront(win.id));
      return;
    }
    if (pinDisabled) return;
    pinWindow(win.id);
  }, [pinned, pinDisabled, pinWindow, unpinWindow, bringToFront, win.id]);

  const onSwap = useCallback(() => {
    bringToFront(win.id);
  }, [bringToFront, win.id]);

  const onClose = useCallback(() => {
    closeWindow(win.id);
  }, [closeWindow, win.id]);

  const onBodyActivate = useCallback(() => {
    /* Promoting a left-sideline (pinned) window to centre via the
     * body click implicitly releases the pin. Otherwise the layout
     * engine would yank it back to the left sideline on the next
     * shuffle, fighting the user's "I want to use this now" intent.
     * The pin button itself remains the way to keep something pinned
     * while still bringing it forward (since the pin button click
     * here already unpins + bringsToFront on the left side). */
    if (pinned) unpinWindow(win.id);
    bringToFront(win.id);
  }, [bringToFront, unpinWindow, pinned, win.id]);

  const Icon = ICONS[win.kind] ?? Sparkles;

  return (
    <motion.div
      data-testid={`sideline-${win.kind}`}
      data-window-id={win.id}
      data-side={side}
      data-pinned={pinned ? "true" : "false"}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className={cn(
        "group absolute flex h-full w-full flex-col overflow-hidden",
        "rounded-xl border border-rule",
        "bg-paper-1/85 backdrop-blur-sm",
        "shadow-[0_1px_2px_rgba(0,0,0,0.02),0_8px_24px_-12px_rgba(0,0,0,0.18)]",
        "hover:bg-paper-1/95 hover:border-rule-strong",
        "transition-colors duration-200",
      )}
    >
      {/* Title strip: status dot, label, controls. Mirrors the centre
          frame so muscle memory transfers between roles. The control
          group stops propagation so clicks don't fall through to the
          body's bringToFront handler. */}
      <div
        className={cn(
          "flex h-9 shrink-0 select-none items-center justify-between px-3",
          "border-b border-rule",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
              hovering ? "bg-accent-indigo" : "bg-ink-35",
            )}
          />
          <Icon size={11} strokeWidth={1.5} className="text-ink-60 shrink-0" />
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.10em] text-ink-60">
            {WINDOW_LABEL[win.kind] ?? win.kind}
          </span>
        </div>
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ShapeButton
            kind="triangle"
            label={
              pinned
                ? "unpin (let go)"
                : pinDisabled
                  ? "left sideline full"
                  : "pin (move to left sideline)"
            }
            disabled={pinDisabled}
            pressing={pressing === "pin"}
            active={pinned}
            onPressStart={() => setPressing("pin")}
            onPressEnd={() => setPressing(null)}
            onClick={onPin}
            testId={`sideline-pin-${side}`}
          />
          {side === "right" && (
            <ShapeButton
              kind="oval"
              label="swap with centre stage"
              pressing={pressing === "swap"}
              onPressStart={() => setPressing("swap")}
              onPressEnd={() => setPressing(null)}
              onClick={onSwap}
              testId="sideline-swap"
            />
          )}
          <ShapeButton
            kind="circle"
            label="close window"
            pressing={pressing === "close"}
            onPressStart={() => setPressing("close")}
            onPressEnd={() => setPressing(null)}
            onClick={onClose}
            testId={`sideline-close-${side}`}
          />
        </div>
      </div>

      {/* Body: click anywhere here to promote the window to centre. */}
      <button
        type="button"
        onClick={onBodyActivate}
        aria-label={`bring ${WINDOW_LABEL[win.kind]} to centre stage`}
        className="min-h-0 flex-1 cursor-pointer text-left"
      >
        <div className="flex h-full flex-col p-3">
          <p className="text-[13px] leading-snug text-ink-90">
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
      </button>
    </motion.div>
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
