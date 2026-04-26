"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useAgentStore, type WindowState } from "@/lib/store";
import { cn } from "@/lib/cn";
import { WINDOW_LABEL } from "./window-labels";

/**
 * Frame for a window that's currently in the centre stage slot.
 *
 * Minimal chrome: hairline border, paper background, a single mono
 * title strip with close and minimise. We intentionally don't expose
 * drag or resize here — the stage layout owns positioning. If the user
 * wants to "free position" a window, that's a separate mode the
 * windows agent can enable later; this component just renders the
 * focal frame.
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
  const minimizeWindow = useAgentStore((s) => s.minimizeWindow);
  const pinWindow = useAgentStore((s) => s.pinWindow);
  const unpinWindow = useAgentStore((s) => s.unpinWindow);
  const pinned = win.pinned === true;

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
      {/* Title strip — calm, one line, mono */}
      <div
        className={cn(
          "flex h-9 shrink-0 items-center justify-between px-4",
          "border-b border-rule",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isFocused ? "bg-accent-indigo" : "bg-ink-35",
            )}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-60">
            {WINDOW_LABEL[win.kind] ?? win.kind}
          </span>
          {win.openedBy === "agent" && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
              · by agent
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => (pinned ? unpinWindow(win.id) : pinWindow(win.id))}
            aria-label={pinned ? "unpin" : "pin to sideline"}
            aria-pressed={pinned}
            title={pinned ? "unpin (let go)" : "pin (keep this in stage)"}
            data-testid="centre-pin"
            data-pinned={pinned ? "true" : "false"}
            className={cn(
              "h-6 w-6 rounded-full",
              "flex items-center justify-center",
              "transition-colors",
              pinned
                ? "text-accent-indigo hover:bg-paper-2"
                : "text-ink-35 hover:bg-paper-2 hover:text-ink-60",
            )}
          >
            {/* Pin glyph: a tiny push-pin. Filled when pinned. */}
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              aria-hidden="true"
              fill={pinned ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5.5 1.5 L5.5 5 L3.5 7 L7.5 7 L5.5 5 Z" />
              <line x1="5.5" y1="7" x2="5.5" y2="9.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => minimizeWindow(win.id)}
            aria-label="minimise"
            data-testid="centre-minimise"
            className={cn(
              "h-6 w-6 rounded-full",
              "flex items-center justify-center",
              "text-ink-35 hover:bg-paper-2 hover:text-ink-60",
              "transition-colors",
            )}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line
                x1="2"
                y1="5"
                x2="8"
                y2="5"
                stroke="currentColor"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => closeWindow(win.id)}
            aria-label="close"
            data-testid="centre-close"
            className={cn(
              "h-6 w-6 rounded-full",
              "flex items-center justify-center",
              "text-ink-35 hover:bg-paper-2 hover:text-ink-60",
              "transition-colors",
            )}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line
                x1="2.5"
                y1="2.5"
                x2="7.5"
                y2="7.5"
                stroke="currentColor"
                strokeLinecap="round"
              />
              <line
                x1="2.5"
                y1="7.5"
                x2="7.5"
                y2="2.5"
                stroke="currentColor"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative min-h-0 flex-1">{children}</div>
    </motion.div>
  );
}
