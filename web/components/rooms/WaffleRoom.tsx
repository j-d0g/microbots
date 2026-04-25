"use client";

import { useCallback, useEffect } from "react";
import { useAgentStore, type DockState } from "@/lib/store";
import { useWebSpeech } from "@/lib/voice";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { registerTools } from "@/lib/room-tools";
import { cn } from "@/lib/cn";

const SUGGESTIONS = [
  "raise my bug-triage threshold to 0.92",
  "show me last night's brief",
  "remind me about stale PRs at 17:00",
];

export function WaffleRoom(_props: { payload?: Record<string, unknown> }) {
  const transcript = useAgentStore((s) => s.transcript);
  const dock = useAgentStore((s) => s.dock);
  const setDock = useAgentStore((s) => s.setDock);
  const appendTranscript = useAgentStore((s) => s.appendTranscript);
  const clearTranscript = useAgentStore((s) => s.clearTranscript);
  const roomState = useAgentStore((s) => s.roomStates.waffle);
  const { supported, listening, start, stop } = useWebSpeech();

  const setTranscript = useCallback(
    (text: string) => {
      clearTranscript();
      if (text) appendTranscript(text);
    },
    [appendTranscript, clearTranscript],
  );

  /* ---- agent tools ---- */

  useEffect(() => {
    return registerTools("waffle", [
      {
        name: "set_state",
        description: "Set the voice/dock state (idle|listening|thinking|speaking|hidden).",
        args: { state: "DockState" },
        run: (args) => {
          const v = args.state as DockState | undefined;
          if (!v) return;
          if (
            v === "idle" ||
            v === "listening" ||
            v === "thinking" ||
            v === "speaking" ||
            v === "hidden"
          ) {
            setDock(v);
          }
        },
      },
      {
        name: "set_transcript",
        description: "Replace the live transcript with given text. Empty clears.",
        args: { text: "string" },
        run: (args) => {
          setTranscript(typeof args.text === "string" ? args.text : "");
        },
      },
      {
        name: "append_transcript",
        description: "Append a chunk to the transcript (streaming style).",
        args: { text: "string" },
        run: (args) => {
          const t = typeof args.text === "string" ? args.text : "";
          if (t) appendTranscript(t);
        },
      },
      {
        name: "clear_transcript",
        description: "Clear the transcript.",
        run: () => clearTranscript(),
      },
    ]);
  }, [appendTranscript, clearTranscript, setDock, setTranscript]);

  const stateLabel =
    dock === "listening"
      ? "listening"
      : dock === "thinking"
        ? "thinking"
        : dock === "speaking"
          ? "speaking"
          : "ready";

  return (
    <RoomStateOverlay room="waffle" state={roomState}>
      <div className="@container/waffle flex h-full w-full items-center justify-center">
        <section
          className="flex w-full max-w-[640px] flex-col items-center justify-center text-center px-4"
          data-testid="waffle-room-content"
        >
          <p
            className="font-mono text-[11px] uppercase tracking-wider text-ink-35"
            data-testid="waffle-state-label"
          >
            waffle · {stateLabel}
          </p>
          <h1
            className="mt-3 font-medium leading-[1.05] tracking-tight text-ink-90"
            style={{ fontSize: "clamp(22px, 5cqw, 40px)" }}
          >
            What is on your mind?
          </h1>
          <p className="mt-3 max-w-[44ch] text-[14px] leading-relaxed text-ink-60 @[640px]/waffle:text-[15px]">
            {supported
              ? "hold the dot. tell me what you need automated."
              : "voice not available in this browser. press / to type instead."}
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
                "mt-10 flex items-center justify-center rounded-full",
                "h-20 w-20 @[640px]/waffle:h-24 @[640px]/waffle:w-24",
                "transition-all duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                "hover:bg-paper-2 active:scale-95",
                listening && "bg-paper-2",
              )}
            >
              <span
                className={cn(
                  "block rounded-full transition-all duration-200",
                  "h-5 w-5 @[640px]/waffle:h-6 @[640px]/waffle:w-6",
                  listening || dock === "listening"
                    ? "bg-accent-indigo breathing scale-110"
                    : dock === "thinking"
                      ? "bg-ink-35 breathing"
                      : dock === "speaking"
                        ? "bg-accent-indigo"
                        : "bg-ink-90",
                )}
              />
            </button>
          )}

          <div className="mt-10 min-h-[88px] w-full">
            {transcript ? (
              <p
                className="ink-in mx-auto max-w-[52ch] leading-relaxed text-ink-90"
                style={{ fontSize: "clamp(15px, 2.4cqw, 18px)" }}
                data-testid="waffle-transcript"
              >
                {transcript}
              </p>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <p className="font-mono text-[11px] text-ink-35">
                  {dock === "listening"
                    ? "listening..."
                    : dock === "thinking"
                      ? "thinking..."
                      : "silence."}
                </p>
                <ul className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <li
                      key={s}
                      className="rounded-sm border border-rule px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-35"
                    >
                      &ldquo;{s}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </RoomStateOverlay>
  );
}
