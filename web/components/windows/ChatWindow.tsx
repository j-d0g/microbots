"use client";

import { useEffect, useRef } from "react";
import { useAgentStore, type ChatMessage } from "@/lib/store";
import { cn } from "@/lib/cn";

/**
 * Chat history window — V1 minimal.
 *
 * Renders the rolling transcript of `chatMessages` from the store
 * (the same source the chat-mode `<ChatPanel/>` uses). Both surfaces
 * stay in sync: voice/`/`-typed turns push messages into the same
 * array regardless of UI mode, and this window just observes.
 *
 * Scope (per the user's spec):
 *   - User inputs and agent outputs only. No room tags, no actions,
 *     no input composer. Voice + `/` remain the canonical input plane.
 *
 * The window auto-scrolls to the bottom whenever a new message lands.
 */
export function ChatWindow(_props: { payload?: Record<string, unknown> } = {}) {
  const messages = useAgentStore((s) => s.chatMessages);
  const dock = useAgentStore((s) => s.dock);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Autoscroll on new turn.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages.at(-1)?.text.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-35">
          chat
        </p>
        <p className="text-[13px] leading-snug text-ink-60 max-w-[26ch]">
          your voice and typed prompts will land here as a transcript.
        </p>
        <p className="font-mono text-[10px] tracking-wider text-ink-35 mt-1">
          press <span className="text-ink-90">/</span> to type ·
          hold <span className="text-ink-90">.</span> to talk
        </p>
      </div>
    );
  }

  const lastIsAgentStreaming =
    messages.at(-1)?.role === "agent" && messages.at(-1)?.status === "streaming";
  const showThinking = dock === "thinking" && !lastIsAgentStreaming;

  return (
    <div
      ref={scrollRef}
      className="muji-scroll h-full overflow-y-auto overflow-x-hidden px-4 py-3"
      data-testid="chat-window-scroll"
    >
      <ol className="flex flex-col gap-3">
        {messages.map((m) => (
          <li key={m.id}>
            <Bubble message={m} />
          </li>
        ))}
        {showThinking && (
          <li>
            <Thinking />
          </li>
        )}
      </ol>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const streaming = message.status === "streaming";
  return (
    <article
      data-testid={`chat-window-msg-${message.role}`}
      data-status={message.status ?? "done"}
      className="flex flex-col gap-1"
    >
      <header className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-[9px] uppercase tracking-[0.10em]",
            isUser ? "text-ink-35" : "text-accent-indigo/80",
          )}
        >
          {isUser ? "you" : "agent"}
        </span>
        <span className="ml-auto font-mono text-[9px] tabular-nums text-ink-35">
          {formatTs(message.ts)}
        </span>
      </header>
      <p
        className={cn(
          "whitespace-pre-wrap text-[13px] leading-relaxed text-ink-90",
        )}
      >
        {message.text}
        {streaming && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-[11px] w-[5px] translate-y-[1px] bg-accent-indigo breathing"
          />
        )}
      </p>
    </article>
  );
}

function Thinking() {
  return (
    <article className="flex flex-col gap-1" data-testid="chat-window-thinking">
      <header className="flex items-baseline gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.10em] text-accent-indigo/80">
          agent
        </span>
      </header>
      <p className="font-mono text-[11px] text-ink-35">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-indigo align-middle breathing" />
        thinking
      </p>
    </article>
  );
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
