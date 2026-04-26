"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useAgentStore, type WindowState } from "@/lib/store";
import { cn } from "@/lib/cn";
import { WINDOW_LABEL } from "./window-labels";
import { ShapeButton } from "./ShapeButton";
import { MAX_LEFT_SIDELINE } from "@/lib/stage-manager";

/**
 * Frame for a window in the centre stage slot.
 *
 * Three bare-shape affordances live in the title strip:
 *
 *   △ triangle △
 *     Pin / unpin. A pinned window is exempt from agent-driven
 *     re-layout AND from the swap control — it stays put for a
 *     reason. Filled indigo when pinned, hollow when not.
 *
 *   ─── pill (oval) ───
 *     Symmetric "swap centre stage" toggle. Brings the most recent
 *     unpinned non-self window forward — the layout engine then puts
 *     the current centre into a sideline slot. Pinned windows are
 *     deliberately ineligible (they'd just snap back). When there's
 *     nothing to swap with the pill is disabled.
 *
 *   ─ circle ─
 *     Remove. Closes the window.
 *
 * Pill + circle are filled shapes with no glyph; triangle is
 * outlined / filled to communicate the toggle state at a glance.
 * Tooltip + aria label carry the action wording. Hover state hints
 * at intent: triangle warms indigo, pill warms indigo, circle reddens.
 *
 * Edge-case guards:
 *   - Disabled buttons set tabIndex=-1 + pointer-events:none so they
 *     can't fire during layout transitions.
 *   - The swap action is rAF-debounced and latched for ~320ms — long
 *     enough that the framer-motion spring has settled. Two rapid
 *     clicks become one bringToFront call (otherwise two zIndex bumps
 *     in the same frame fight for the centre slot).
 *   - The control group stops propagation on click/mousedown so the
 *     parent stage's "click anywhere brings to front" handler never
 *     fires from a controls click.
 */
export function CentreFrame({
  win,
  children,
  isFocused,
}: {
  win: WindowState;
  children: ReactNode;
  isFocused: boolean;
}) {
  const closeWindow = useAgentStore((s) => s.closeWindow);
  const bringToFront = useAgentStore((s) => s.bringToFront);
  const pinWindow = useAgentStore((s) => s.pinWindow);
  const unpinWindow = useAgentStore((s) => s.unpinWindow);
  const windows = useAgentStore((s) => s.windows);
  const pinned = win.pinned === true;
  const swapCandidate = useMemo(
    () => pickSwapCandidate(windows, win.id),
    [windows, win.id],
  );
  /* Pin button is refused when the left sideline is already full of
   * OTHER pinned windows. If self is currently pinned, the button
   * acts as "unpin" and is always enabled. */
  const otherPinnedCount = useMemo(
    () => windows.filter((w) => w.pinned && w.id !== win.id).length,
    [windows, win.id],
  );
  const pinDisabled = !pinned && otherPinnedCount >= MAX_LEFT_SIDELINE;

  const [pressing, setPressing] = useState<"pin" | "swap" | "close" | null>(null);
  const swapPendingRef = useRef(false);

  const canSwap = swapCandidate !== null;

  const onSwap = useCallback(() => {
    if (!canSwap || !swapCandidate) return;
    if (swapPendingRef.current) return;
    swapPendingRef.current = true;
    requestAnimationFrame(() => {
      bringToFront(swapCandidate);
      window.setTimeout(() => {
        swapPendingRef.current = false;
      }, 320);
    });
  }, [bringToFront, canSwap, swapCandidate]);

  const onClose = useCallback(() => {
    closeWindow(win.id);
  }, [closeWindow, win.id]);

  const onPin = useCallback(() => {
    if (pinned) {
      unpinWindow(win.id);
      return;
    }
    if (pinDisabled) return;
    /* Pinning the centre window: pin first, then promote a swap
     * candidate so the layout engine routes this (now pinned) window
     * into the left sideline — pinned windows live on the left, by
     * design. If there's no candidate (this is the only open window)
     * we still pin; the next opened window will displace it. */
    pinWindow(win.id);
    if (swapCandidate) {
      // Defer the focus change one frame so the pin state lands first.
      requestAnimationFrame(() => bringToFront(swapCandidate));
    }
  }, [pinned, pinDisabled, pinWindow, unpinWindow, win.id, swapCandidate, bringToFront]);

  return (
    <motion.div
      data-testid={`centre-${win.kind}`}
      data-window-id={win.id}
      data-focused={isFocused ? "true" : "false"}
      className={cn(
        "absolute flex h-full w-full flex-col overflow-hidden",
        "rounded-2xl border border-rule bg-paper-0",
        "shadow-[0_2px_4px_rgba(0,0,0,0.03),0_18px_44px_-22px_rgba(0,0,0,0.30)]",
      )}
    >
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
              isFocused ? "bg-accent-indigo" : "bg-ink-35",
            )}
          />
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.10em] text-ink-60">
            {WINDOW_LABEL[win.kind] ?? win.kind}
          </span>
          {win.openedBy === "agent" && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
              · by agent
            </span>
          )}
        </div>

        <div
          className="flex items-center gap-2"
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
            testId="centre-pin"
          />
          <ShapeButton
            kind="oval"
            label={canSwap ? "swap to sideline" : "no other window to swap with"}
            disabled={!canSwap}
            pressing={pressing === "swap"}
            onPressStart={() => setPressing("swap")}
            onPressEnd={() => setPressing(null)}
            onClick={onSwap}
            testId="centre-swap"
          />
          <ShapeButton
            kind="circle"
            label="close window"
            pressing={pressing === "close"}
            onPressStart={() => setPressing("close")}
            onPressEnd={() => setPressing(null)}
            onClick={onClose}
            testId="centre-close"
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">{children}</div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Pick which window the swap-control should bring forward when the
 * current centre window is "swapped out". Returns `null` when there's
 * nothing to swap with — the control disables itself.
 *
 * Selection rules:
 *   - Skip the active centre window itself.
 *   - Skip ask_user (modal) and minimised windows.
 *   - Skip pinned windows — the user pinned them on purpose; the
 *     layout engine refuses to demote them anyway, so promoting one
 *     would either no-op or fight the engine. They simply opt out of
 *     the swap rotation.
 *   - Graph IS a valid swap target — promoting it brings it out of
 *     backdrop into centre.
 *   - Among the rest, pick the highest-zIndex (most recently focused
 *     sideline). That's the "natural undo" of the last bringToFront.
 */
function pickSwapCandidate(
  windows: ReadonlyArray<WindowState>,
  selfId: string,
): string | null {
  let best: WindowState | null = null;
  for (const w of windows) {
    if (w.id === selfId) continue;
    if (w.minimized) continue;
    if (w.kind === "ask_user") continue;
    if (w.pinned) continue;
    if (!best || w.zIndex > best.zIndex) best = w;
  }
  return best?.id ?? null;
}
