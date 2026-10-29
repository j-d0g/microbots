"use client";

import { forwardRef, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { ChatVoiceButton } from "./ChatVoiceButton";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  onSubmit: (event?: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStop: () => void;
  agentStatus: string;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    {
      input,
      setInput,
      busy,
      onSubmit,
      onKeyDown,
      onStop,
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
            "border-rule focus-within:border-ink-90",
          )}
        >
          <ChatVoiceButton />
          <textarea
            ref={ref}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={busy ? "thinking…" : "ask the agent. enter to send."}
            rows={1}
            data-testid="chat-input"
            className={cn(
              "max-h-[160px] flex-1 resize-none bg-transparent",
              "py-1.5 text-[14px] leading-relaxed tracking-tight text-ink-90",
              "outline-none placeholder:text-ink-35",
            )}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              data-testid="chat-stop"
              className={cn(
                "shrink-0 rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider",
                "border-rule bg-paper-0 text-ink-60 transition-colors hover:border-ink-90 hover:text-ink-90",
              )}
            >
              stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              data-testid="chat-send"
              className={cn(
                "shrink-0 rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider",
                "transition-all duration-150 disabled:pointer-events-none disabled:opacity-30",
                "border-ink-90 bg-ink-90 text-paper-0 hover:bg-accent-indigo",
              )}
            >
              send
            </button>
          )}
        </div>
        <StatusLine
          busy={busy}
          agentStatus={agentStatus}
        />
      </form>
    );
  },
);

function StatusLine({
  busy,
  agentStatus,
}: {
  busy: boolean;
  agentStatus: string;
}) {
  const text = busy ? agentStatus || "thinking…" : "enter to send · shift+enter for newline · hold mic to talk";
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
