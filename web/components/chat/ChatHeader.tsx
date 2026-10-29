"use client";

import { LayoutGrid, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function ChatHeader({
  onToggleMode,
  onClear,
  canClear,
}: {
  onToggleMode: () => void;
  onClear: () => void;
  canClear: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-rule px-5">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-60">
        microbots
      </span>
      <span className="font-mono text-[10px] text-ink-35">· chat</span>
      {canClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="clear chat"
          title="clear chat"
          className="ml-auto flex h-7 items-center gap-1.5 rounded-sm px-2 font-mono text-[10px] uppercase tracking-wider text-ink-35 transition-colors hover:bg-paper-1 hover:text-ink-90"
        >
          <Trash2 size={11} strokeWidth={1.6} />
          clear
        </button>
      )}
      <button
        type="button"
        onClick={onToggleMode}
        aria-label="switch to windowed mode"
        title="switch to windowed mode"
        data-testid="chat-toggle-mode"
        className={cn(
          "ml-auto inline-flex h-7 items-center gap-1.5 rounded-sm border border-rule px-2",
          "font-mono text-[10px] uppercase tracking-wider text-ink-60",
          "transition-colors hover:bg-paper-1 hover:text-ink-90",
          canClear && "ml-0",
        )}
      >
        <LayoutGrid size={12} strokeWidth={1.6} />
        windowed
      </button>
    </header>
  );
}
