"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { InlineCard } from "./cards/InlineCard";
import type { ChatMessage as ChatMessageData } from "@/lib/store";

export function ChatMessage({
  message,
  busy,
  onSubmitAnswer,
}: {
  message: ChatMessageData;
  busy: boolean;
  onSubmitAnswer: (answer: string) => void;
}) {
  const isUser = message.role === "user";
  return (
    <article
      data-testid={`chat-msg-${message.role}`}
      data-status={message.status ?? "done"}
      className="flex flex-col gap-2"
    >
      <header className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.08em]",
            isUser ? "text-ink-35" : "text-accent-indigo/80",
          )}
        >
          {isUser ? "you" : "agent"}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-ink-35">
          {formatTs(message.ts)}
        </span>
      </header>
      {Boolean(message.tools?.length) && (
        <div className="flex flex-wrap gap-1.5" aria-label="tool activity">
          {message.tools?.map((trace) => (
            <span
              key={trace.id}
              className="inline-flex items-center gap-1 rounded-full border border-rule/70 bg-paper-1 px-2 py-1 font-mono text-[9px] tracking-wide text-ink-60"
            >
              {trace.ok === undefined ? (
                <LoaderCircle size={10} className="animate-spin text-accent-indigo" />
              ) : trace.ok ? (
                <Check size={10} className="text-confidence-high" />
              ) : (
                <X size={10} className="text-confidence-low" />
              )}
              {trace.name.replaceAll("_", " ")}
              {trace.ms !== undefined && trace.ms >= 50 && (
                <span className="text-ink-35">{trace.ms}ms</span>
              )}
            </span>
          ))}
        </div>
      )}
      {message.cards?.map((card) => (
        <InlineCard
          key={card.id}
          card={card}
          onSubmitAnswer={onSubmitAnswer}
        />
      ))}
      {(message.text || busy) && (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-90">
          {message.text}
          {busy && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-[12px] w-[6px] translate-y-[1px] bg-accent-indigo breathing"
            />
          )}
        </p>
      )}
    </article>
  );
}

export function PendingMessage({ status }: { status: string }) {
  return (
    <article className="flex flex-col gap-1.5" data-testid="chat-pending">
      <header>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent-indigo/80">
          agent
        </span>
      </header>
      <p className="font-mono text-[12px] text-ink-35">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-indigo align-middle" />
        {status}
      </p>
    </article>
  );
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}
