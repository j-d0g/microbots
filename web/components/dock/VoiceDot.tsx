"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

/**
 * The "dark dot" in the dock.
 *
 * Two gestures, one surface:
 *
 *   - Quick tap (<300ms)  → toggle conversation mode (continuous voice
 *                           chat with the ElevenLabs-backed agent).
 *   - Press & hold        → push-to-talk (mirrors the global `.` key).
 *
 * The actual STT/TTS pipeline lives in <VoiceBridge/> — we just call
 * into its `__voice` handle so both surfaces feed the same submission
 * path. Conversation mode is a store flag read by <ConversationBridge/>.
 */
type VoiceHandle = {
  holding: boolean;
  onPress: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
};

const HOLD_THRESHOLD_MS = 300;

export function VoiceDot() {
  const dock = useAgentStore((s) => s.dock);
  const quietMode = useAgentStore((s) => s.quietMode);
  const conversationMode = useAgentStore((s) => s.conversationMode);
  const toggleConversationMode = useAgentStore((s) => s.toggleConversationMode);
  const [, force] = useState(0);
  const active = dock === "listening" || dock === "conversing";
  const speaking = dock === "speaking";
  const conversing = dock === "conversing" || conversationMode;

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

  // Track whether the current pointer gesture has crossed the hold
  // threshold. If it has, pointerup triggers PTT release instead of a
  // tap-to-toggle.
  const pressStartRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pressStartRef.current = performance.now();
      heldRef.current = false;
      // After HOLD_THRESHOLD_MS, upgrade the gesture to push-to-talk.
      clearHoldTimer();
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        heldRef.current = true;
        // Don't start PTT while conversation mode is already running —
        // VAD is already listening, an extra recorder would fight it.
        if (useAgentStore.getState().conversationMode) return;
        void handle?.onPress();
      }, HOLD_THRESHOLD_MS);
    },
    [handle],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      const wasHeld = heldRef.current;
      const started = pressStartRef.current;
      pressStartRef.current = null;
      heldRef.current = false;
      clearHoldTimer();

      if (wasHeld) {
        void handle?.onRelease();
        return;
      }
      // Quick tap: ignore stray pointerups with no matching down.
      if (started === null) return;
      toggleConversationMode();
    },
    [handle, toggleConversationMode],
  );

  return (
    <button
      type="button"
      aria-label="tap to toggle conversation mode, press and hold to talk"
      aria-pressed={active || conversationMode}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(e) => {
        if (e.buttons) onPointerUp(e);
      }}
      data-testid="voice-dot"
      data-state={conversationMode ? "conversing" : dock}
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
          active && !conversing && "scale-110 bg-accent-indigo breathing",
          conversing && "scale-125 bg-accent-indigo breathing-fast",
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
      {conversing && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-accent-indigo/60 animate-ping"
        />
      )}
    </button>
  );
}
