"use client";

import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { WindowState } from "@/lib/store";

export function AskUserSideline({ win }: { win: WindowState }) {
  const question =
    (win.payload?.question as string) ?? "Agent is asking a question…";
  const options = (win.payload?.options as string[]) ?? [];

  return (
    <div className="pointer-events-none flex h-full flex-col gap-3 p-3">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <HelpCircle size={11} strokeWidth={1.5} className="shrink-0 text-accent-indigo" />
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-accent-indigo">
          agent question
        </span>
      </div>

      {/* Question text */}
      <p className="line-clamp-3 font-mono text-[12px] leading-snug text-ink-90">
        {question}
      </p>

      {/* Options */}
      {options.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {options.map((opt) => (
            <div
              key={opt}
              className={cn(
                "truncate rounded-md border border-rule bg-paper-2/60 px-2.5 py-1.5",
                "font-mono text-[10px] leading-tight text-ink-60",
              )}
            >
              {opt}
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1" />

      {/* Waiting indicator */}
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="breathing h-1.5 w-1.5 shrink-0 rounded-full bg-accent-indigo"
        />
        <span className="font-mono text-[9px] uppercase tracking-[0.10em] text-ink-35">
          waiting…
        </span>
      </div>
    </div>
  );
}
