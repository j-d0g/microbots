"use client";

import { useAgentStore } from "@/lib/store";
import { usePushToTalk } from "@/lib/voice";
import { cn } from "@/lib/cn";

export function VoiceDot() {
  const dock = useAgentStore((s) => s.dock);
  const { onPress, onRelease } = usePushToTalk();
  const active = dock === "listening";
  const speaking = dock === "speaking";

  return (
    <button
      type="button"
      aria-label="push and hold to talk"
      aria-pressed={active}
      onMouseDown={onPress}
      onMouseUp={onRelease}
      onMouseLeave={onRelease}
      onTouchStart={onPress}
      onTouchEnd={onRelease}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded-full",
        "transition-colors duration-200",
        "hover:bg-paper-2",
      )}
    >
      <span
        className={cn(
          "block h-3 w-3 rounded-full",
          active || speaking
            ? "bg-accent-indigo breathing"
            : "bg-ink-90",
        )}
      />
    </button>
  );
}
