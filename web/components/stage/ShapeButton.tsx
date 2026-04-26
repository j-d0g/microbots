"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

/**
 * Bare-shape window control. Three variants share a forgiving 24px
 * square hit target with an inner animated shape:
 *
 *   △ triangle  — pin / unpin (toggle; `active` = pinned)
 *   ─── oval    — swap with centre stage
 *   ─ circle    — close
 *
 * Hover accents communicate intent: triangle + oval warm to indigo,
 * circle reddens (close = caution). Disabled buttons get pointer-
 * events:none and tabIndex=-1 so they can't fire mid-transition.
 *
 * The hit target stays a fixed 24px square; the inner shape is the
 * only thing that scales when pressed — that's how we avoid the "tap
 * shifts the button" feel on quick taps.
 */
export function ShapeButton({
  kind,
  label,
  disabled = false,
  pressing,
  active = false,
  onPressStart,
  onPressEnd,
  onClick,
  testId,
}: {
  kind: "oval" | "circle" | "triangle";
  label: string;
  disabled?: boolean;
  pressing: boolean;
  /** Toggle on-state (used by the triangle pin button). */
  active?: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      onPointerDown={disabled ? undefined : onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      onPointerCancel={onPressEnd}
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={label}
      data-testid={testId}
      data-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "group relative flex h-6 w-6 items-center justify-center",
        "rounded-sm outline-none",
        "focus-visible:ring-2 focus-visible:ring-ink-90/30",
        disabled
          ? "cursor-default pointer-events-none"
          : "cursor-pointer",
      )}
    >
      {kind === "triangle" ? (
        /* Triangle drawn as SVG so we can flip fill/stroke between
           the active (filled, pinned) and inactive (outlined) states.
           Apex points down — visually evokes a pushpin / drop. */
        <motion.svg
          aria-hidden="true"
          initial={false}
          animate={{ scale: pressing && !disabled ? 0.85 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
          width="11"
          height="10"
          viewBox="0 0 11 10"
          className={cn(
            "transition-colors duration-150",
            disabled
              ? "text-ink-35/30"
              : active
                ? "text-accent-indigo"
                : "text-ink-35/70 group-hover:text-accent-indigo",
          )}
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5.5 8.8 L10 1.4 L1 1.4 Z" />
        </motion.svg>
      ) : (
        <motion.span
          aria-hidden
          initial={false}
          animate={{ scale: pressing && !disabled ? 0.85 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
          className={cn(
            "block transition-colors duration-150",
            // Geometry — straight-edged oval (pill) vs. true circle.
            kind === "oval"
              ? "h-[10px] w-[18px] rounded-full"
              : "h-[10px] w-[10px] rounded-full",
            // Calm grey at rest, ink-90 on hover for "press me",
            // disabled is even more muted.
            disabled
              ? "bg-ink-35/30"
              : "bg-ink-35/60 group-hover:bg-ink-90",
            // Per-shape hover accent on enabled buttons:
            //  oval → indigo (swap = primary action)
            //  circle → confidence-low / red (close = caution)
            !disabled && kind === "oval" && "group-hover:bg-accent-indigo",
            !disabled && kind === "circle" && "group-hover:bg-confidence-low",
          )}
        />
      )}
    </button>
  );
}
