"use client";

import { useAgentStore } from "@/lib/store";
import { useWebSpeech } from "@/lib/voice";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { cn } from "@/lib/cn";

export function WaffleRoom(_props: { payload?: Record<string, unknown> }) {
  const transcript = useAgentStore((s) => s.transcript);
  const dock = useAgentStore((s) => s.dock);
  const roomState = useAgentStore((s) => s.roomStates.waffle);
  const { supported, listening, start, stop } = useWebSpeech();

  return (
    <RoomStateOverlay room="waffle" state={roomState}>
      <section className="flex min-h-[540px] flex-col items-center justify-center text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          waffle
        </p>
        <h1 className="mt-3 text-[40px] font-medium leading-[1.1] tracking-tight">
          What is on your mind?
        </h1>
        <p className="mt-3 max-w-[480px] text-[15px] leading-relaxed text-ink-60">
          {supported
            ? "Press and hold the dot below. Tell me the part of your day you wish someone else was doing."
            : "Voice is not available in this browser. Type your thoughts using / instead."}
        </p>

        {supported && (
          <button
            type="button"
            onMouseDown={start}
            onMouseUp={stop}
            onMouseLeave={stop}
            onTouchStart={start}
            onTouchEnd={stop}
            data-testid="waffle-voice-dot"
            className={cn(
              "mt-12 flex h-24 w-24 items-center justify-center rounded-full",
              "transition-all duration-200",
              "hover:bg-paper-2",
            )}
          >
            <span
              className={cn(
                "block h-6 w-6 rounded-full transition-all duration-200",
                listening
                  ? "bg-accent-indigo breathing scale-110"
                  : "bg-ink-90",
              )}
            />
          </button>
        )}

        <div className="mt-12 min-h-[120px] max-w-[640px]">
          {transcript ? (
            <p className="ink-in text-[18px] leading-relaxed text-ink-90">
              {transcript}
            </p>
          ) : (
            <p className="font-mono text-[12px] text-ink-35">
              {dock === "listening" ? "listening..." : "silence."}
            </p>
          )}
        </div>
      </section>
    </RoomStateOverlay>
  );
}
