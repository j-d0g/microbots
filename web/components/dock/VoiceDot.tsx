"use client";

import { useEffect, useState, type PointerEvent } from "react";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

/**
 * Press-and-hold dot in the dock. Mirrors the global `.` key — the
 * actual STT pipeline lives in <VoiceBridge/>. Here we just call into
 * the bridge's `__voice` handle (set on mount) so both surfaces feed
 * the same submission path.
 */
type VoiceHandle = {
  holding: boolean;
  onPress: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
};

export function VoiceDot() {
  const dock = useAgentStore((s) => s.dock);
  const quietMode = useAgentStore((s) => s.quietMode);
  const [, force] = useState(0);
  const active = dock === "listening";
  const speaking = dock === "speaking";

  // Re-render when the bridge handle becomes available (it's set in
  // a useEffect, after first paint).
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      force((n) => n + 1);
    };
    const t = window.setTimeout(tick, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const handle: VoiceHandle | undefined =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as { __voice?: VoiceHandle }).__voice;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    void handle?.onPress();
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    void handle?.onRelease();
  };

  return (
    <button
      type="button"
      aria-label="press and hold to talk (or press . anywhere)"
      aria-pressed={active}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(e) => {
        if (e.buttons) onPointerUp(e);
      }}
      data-testid="voice-dot"
      data-state={dock}
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
        "transition-colors duration-200",
        "hover:bg-paper-2",
        active && "bg-accent-indigo/8",
      )}
    >
      <span
        className={cn(
          "block h-2.5 w-2.5 rounded-full transition-all duration-[160ms]",
          active && "scale-110 bg-accent-indigo breathing",
          speaking && "bg-accent-indigo breathing",
          !active && !speaking && !quietMode && "bg-ink-90",
          !active && !speaking && quietMode && "border border-accent-indigo bg-transparent",
        )}
      />
      {active && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full ring-1 ring-accent-indigo/40 animate-pulse"
        />
      )}
    </button>
  );
}
