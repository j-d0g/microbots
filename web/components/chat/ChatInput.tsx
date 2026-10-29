"use client";

import { forwardRef, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic } from "lucide-react";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  listening: boolean;
  voiceSupported: boolean;
  startVoice: () => void;
  stopVoice: () => void;
  onSubmit: (event?: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  dock: ReturnType<typeof useAgentStore.getState>["dock"];
  agentStatus: string;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    {
      input,
      setInput,
      busy,
      listening,
      voiceSupported,
      startVoice,
      stopVoice,
      onSubmit,
      onKeyDown,
      dock,
      agentStatus,
    },
    ref,
  ) {
    return (
      <form
        onSubmit={onSubmit}
        className="shrink-0 border-t border-rule bg-paper-0 px-5 pt-3 pb-4"
      >
        <div
          className={cn(
            "flex items-end gap-2 rounded-md border bg-paper-1 px-3 py-2",
            "transition-colors duration-150",
            listening
              ? "border-accent-indigo/60"
              : "border-rule focus-within:border-ink-90",
          )}
        >
          {voiceSupported && (
            <button
              type="button"
              onMouseDown={startVoice}
              onMouseUp={stopVoice}
              onMouseLeave={stopVoice}
              onTouchStart={startVoice}
              onTouchEnd={stopVoice}
              data-testid="chat-voice-dot"
              aria-label="hold to talk"
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-sm",
                "transition-colors duration-150",
                listening
                  ? "bg-accent-indigo/15 text-accent-indigo"
                  : "text-ink-35 hover:bg-paper-2 hover:text-ink-90",
              )}
            >
              <Mic size={14} strokeWidth={1.6} />
            </button>
          )}
          <textarea
            ref={ref}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              listening
                ? "listening…"
                : busy
                  ? "thinking…"
                  : "ask the agent. enter to send."
            }
            rows={1}
            disabled={busy}
            data-testid="chat-input"
            className={cn(
              "max-h-[160px] flex-1 resize-none bg-transparent",
              "py-1.5 text-[14px] leading-relaxed tracking-tight text-ink-90",
              "outline-none placeholder:text-ink-35",
              "disabled:opacity-60",
            )}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            data-testid="chat-send"
            className={cn(
              "shrink-0 rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider",
              "transition-all duration-150 disabled:pointer-events-none disabled:opacity-30",
              "border-ink-90 bg-ink-90 text-paper-0 hover:bg-accent-indigo",
            )}
          >
            {busy ? "…" : "send"}
          </button>
        </div>
        <StatusLine
          busy={busy}
          dock={dock}
          agentStatus={agentStatus}
          listening={listening}
        />
      </form>
    );
  },
);

function StatusLine({
  busy,
  dock,
  agentStatus,
  listening,
}: {
  busy: boolean;
  dock: ReturnType<typeof useAgentStore.getState>["dock"];
  agentStatus: string;
  listening: boolean;
}) {
  const text = listening
    ? "listening…"
    : busy
      ? agentStatus || dockLabel(dock)
      : "enter to send · shift+enter for newline · hold mic to talk";
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.p
        key={text}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={{ duration: 0.18 }}
        className="mt-2 truncate font-mono text-[10px] tracking-wider text-ink-35"
        data-testid="chat-status"
      >
        {text}
      </motion.p>
    </AnimatePresence>
  );
}

function dockLabel(state: ReturnType<typeof useAgentStore.getState>["dock"]) {
  switch (state) {
    case "thinking":
      return "thinking…";
    case "speaking":
      return "speaking…";
    case "listening":
      return "listening…";
    default:
      return "ready.";
  }
}
