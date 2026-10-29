"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

type VoiceHandle = {
  onPress: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
  live?: boolean;
  toggleLive?: () => void;
};

export function ChatVoiceButton() {
  const dock = useAgentStore((s) => s.dock);
  const [, force] = useState(0);
  const active = dock === "listening";
  const speaking = dock === "speaking";
  const pressedRef = useRef(false);

  useEffect(() => {
    const refresh = () => force((n) => n + 1);
    const timer = window.setTimeout(() => force((n) => n + 1), 80);
    window.addEventListener("voice-handle-change", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("voice-handle-change", refresh);
    };
  }, []);

  const handle: VoiceHandle | undefined =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as { __voice?: VoiceHandle }).__voice;

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (handle?.live) {
        handle.toggleLive?.();
        return;
      }
      if (pressedRef.current) return;
      pressedRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      void handle?.onPress();
    },
    [handle],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (handle?.live) return;
      event.preventDefault();
      if (!pressedRef.current) return;
      pressedRef.current = false;
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      void handle?.onRelease();
    },
    [handle],
  );

  return (
    <button
      type="button"
      aria-label={handle?.live ? "toggle live conversation" : "hold to talk"}
      aria-pressed={active}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="chat-voice-dot"
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
          !active && !speaking && "bg-ink-90",
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
