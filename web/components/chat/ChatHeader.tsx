"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAgentStore } from "@/lib/store";

export function ChatHeader({
  onClear,
  canClear,
}: {
  onClear: () => void;
  canClear: boolean;
}) {
  const health = useAgentStore((state) => state.backendHealth);
  const degraded = !!health && (!health.apiOk || !health.surrealOk);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-rule px-5">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-60">
        microbots
      </span>
      <span className="font-mono text-[10px] text-ink-35">· chat</span>
      <Link
        href="/settings"
        aria-label={`system health ${degraded ? "degraded" : "ok"}; open settings`}
        title={`health: ${degraded ? "degraded" : "ok"}`}
        data-testid="chat-health"
        className={cn(
          "ml-auto flex h-6 items-center gap-1.5 rounded-sm px-1.5 font-mono text-[9px] uppercase tracking-wider",
          "text-ink-35 transition-colors hover:bg-paper-1 hover:text-ink-60",
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", degraded ? "bg-amber-500" : "bg-emerald-500")} />
        {degraded ? "degraded" : "ok"}
      </Link>
      {canClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="clear chat"
          title="clear chat"
          className="ml-0 flex h-7 items-center gap-1.5 rounded-sm px-2 font-mono text-[10px] uppercase tracking-wider text-ink-35 transition-colors hover:bg-paper-1 hover:text-ink-90"
        >
          <Trash2 size={11} strokeWidth={1.6} />
          clear
        </button>
      )}
    </header>
  );
}
