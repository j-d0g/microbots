"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAgentStore, type ChatMessage } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import { cn } from "@/lib/cn";

/**
 * Chat history window.
 *
 * Renders the rolling transcript of `chatMessages` from the store —
 * the same source the chat-mode `<ChatPanel/>` uses, so voice and
 * `/`-typed turns land in this window regardless of which UI mode
 * the user is in. The window itself is a passive observer of that
 * shared array; the agent can call `open_window({ kind: "chat" })`
 * to surface it on stage.
 *
 * Visual model:
 *   • Each message is a bubble with role + timestamp header. New
 *     bubbles fade and slide in via framer-motion (stiff spring) so
 *     the transcript reads as a paper trail being laid down rather
 *     than a list mutation.
 *   • The active agent bubble shows a rectangular caret right after
 *     its trailing text. The caret blinks at a steady ~1Hz cadence
 *     and visually "moves" as new chunks extend the text — that's
 *     how the user can see the agent writing in real time.
 *   • Auto-scrolls to the bottom whenever new content lands.
 *
 * Scope:
 *   • User inputs and agent outputs only. No room tags, no actions,
 *     no input composer. Voice + `/` remain the canonical input plane.
 */
export function ChatWindow(_props: { payload?: Record<string, unknown> } = {}) {
  const messages = useAgentStore((s) => s.chatMessages);
  const dock = useAgentStore((s) => s.dock);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on every new chunk (length of the trailing message
  // changes when the agent streams text).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages.at(-1)?.text.length]);

  /* Register UI handlers for the orchestrator's `chat_*` tools. The
   * chat history is store-driven so most tools are pure narration
   * hooks; scroll/jump tools manipulate the scroll container directly. */
  useEffect(() => {
    const scrollTo = (top: number) => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top, behavior: "smooth" });
    };
    return registerTools("chat", [
      {
        name: "scroll_to_top",
        description: "Scroll the chat history to the oldest message.",
        run: () => scrollTo(0),
      },
      {
        name: "scroll_to_bottom",
        description: "Scroll the chat history to the newest message.",
        run: () => scrollTo(scrollRef.current?.scrollHeight ?? 0),
      },
      {
        name: "jump_to_timestamp",
        description:
          "Find the first message at or after the timestamp and scroll to it.",
        args: { ts: "number" },
        run: (args) => {
          const ts = Number(args.ts);
          if (!Number.isFinite(ts)) return;
          const target = messages.find((m) => m.ts >= ts);
          if (!target) return;
          const el = document.querySelector<HTMLElement>(
            `[data-testid="chat-window-msg-${target.role}"][data-ts="${target.ts}"]`,
          );
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        },
      },
      {
        name: "search_messages",
        description: "Narration hook — agent reads matching messages aloud.",
        run: () => {
          /* No in-window search filter yet; kept registered so the
           * agent's tool call doesn't warn-and-noop. */
        },
      },
      {
        name: "filter_by_role",
        description: "Narration hook — no in-window role filter yet.",
        run: () => {
          /* Same as above — registered to keep registry clean. */
        },
      },
      {
        name: "summarize_thread",
        description: "Narration hook — agent narrates the summary aloud.",
        run: () => {
          /* The orchestrator computes the summary; UI just listens. */
        },
      },
      {
        name: "export_transcript",
        description: "Narration hook — orchestrator handles file export.",
        run: () => {
          /* No UI surface for export yet. */
        },
      },
    ]);
  }, [messages]);

  if (messages.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-35">
          chat
        </p>
        <p className="max-w-[26ch] text-[13px] leading-snug text-ink-60">
          your voice and typed prompts will land here as a transcript.
        </p>
        <p className="mt-1 font-mono text-[10px] tracking-wider text-ink-35">
          press <span className="text-ink-90">/</span> to type ·
          hold <span className="text-ink-90">.</span> to talk
        </p>
      </motion.div>
    );
  }

  const last = messages.at(-1);
  const lastIsAgentStreaming =
    last?.role === "agent" && last.status === "streaming";
  const showThinking = dock === "thinking" && !lastIsAgentStreaming;

  return (
    <div
      ref={scrollRef}
      className="muji-scroll h-full overflow-y-auto overflow-x-hidden px-4 py-3"
      data-testid="chat-window-scroll"
    >
      <ol className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.li
              key={m.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{
                type: "spring",
                stiffness: 360,
                damping: 32,
                mass: 0.6,
              }}
            >
              <Bubble message={m} />
            </motion.li>
          ))}
          {showThinking && (
            <motion.li
              key="thinking"
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <Thinking />
            </motion.li>
          )}
        </AnimatePresence>
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
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-90">
        {message.text}
        {streaming && <Caret />}
      </p>
    </article>
  );
}

/**
 * Rectangular blinking caret rendered inline with the streaming
 * text. Sits right after the trailing character so it visually
 * advances as new chunks land — that's the "moves while the agent
 * writes" feel. We use framer-motion's keyframes for a clean on/off
 * blink (sharper than the css `breathe` scale-pulse).
 */
function Caret() {
  return (
    <motion.span
      aria-hidden
      data-testid="chat-window-caret"
      className="ml-0.5 inline-block h-[11px] w-[6px] translate-y-[1px] bg-accent-indigo"
      animate={{ opacity: [1, 1, 0, 0, 1] }}
      transition={{
        duration: 1.0,
        ease: "linear",
        times: [0, 0.49, 0.5, 0.99, 1],
        repeat: Infinity,
      }}
    />
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
