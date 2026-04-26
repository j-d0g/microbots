"use client";

import { useCallback } from "react";
import { BarChart3 } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { getChatsSummary, type ChatSummaryRow } from "@/lib/kg-client";
import { cn } from "@/lib/cn";

const LEVEL_DOT: Record<ChatSummaryRow["signal_level"], string> = {
  high: "bg-confidence-high",
  mid: "bg-confidence-med",
  low: "bg-confidence-low",
};

const LEVEL_BAR: Record<ChatSummaryRow["signal_level"], string> = {
  high: "bg-accent-indigo",
  mid: "bg-accent-indigo/50",
  low: "bg-accent-indigo/20",
};

export function ChatsSummarySideline({ win }: { win: WindowState }) {
  const userId = useAgentStore((s) => s.userId);
  const seed = (win.payload?.summary as ChatSummaryRow[] | undefined) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) => getChatsSummary(userId, signal),
    [userId],
  );

  const { data, loading } = useKgResource(fetcher, seed);
  const rows = data ?? [];

  const total = rows.reduce((s, r) => s + r.count, 0);
  const highCount = rows.filter((r) => r.signal_level === "high").reduce((s, r) => s + r.count, 0);
  const midCount = rows.filter((r) => r.signal_level === "mid").reduce((s, r) => s + r.count, 0);
  const lowCount = rows.filter((r) => r.signal_level === "low").reduce((s, r) => s + r.count, 0);
  const integrationCount = new Set(rows.map((r) => r.integration)).size;
  const maxCount = rows.length > 0 ? Math.max(...rows.map((r) => r.count)) : 1;

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-rule/40 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-35">signal</span>
        <span className={cn("font-mono text-[10px] text-ink-60", loading && rows.length === 0 ? "opacity-40" : "")}>
          {loading && rows.length === 0 ? "—" : total}
        </span>
      </div>

      {rows.length === 0 && !loading ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <BarChart3 size={18} strokeWidth={1.25} className="text-ink-35 opacity-60" />
          <span className="font-mono text-[10px] text-ink-35">no signal data yet</span>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="shrink-0 border-b border-rule/30 px-3 py-2 space-y-1">
            <div className="flex justify-between">
              <span className="font-mono text-[9px] text-ink-35">integrations</span>
              <span className="font-mono text-[9px] tabular-nums text-ink-90">{integrationCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1 font-mono text-[9px] text-ink-35">
                <span className="h-1.5 w-1.5 rounded-full bg-confidence-high" />high
              </span>
              <span className="font-mono text-[9px] tabular-nums text-ink-90">{highCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1 font-mono text-[9px] text-ink-35">
                <span className="h-1.5 w-1.5 rounded-full bg-confidence-med" />mid
              </span>
              <span className="font-mono text-[9px] tabular-nums text-ink-90">{midCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1 font-mono text-[9px] text-ink-35">
                <span className="h-1.5 w-1.5 rounded-full bg-confidence-low" />low
              </span>
              <span className="font-mono text-[9px] tabular-nums text-ink-90">{lowCount}</span>
            </div>
          </div>

          {/* Mini bar chart per integration */}
          <div className="muji-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.10em] text-ink-35">by source</p>
            {rows.map((row, idx) => (
              <div key={`${row.integration}-${row.signal_level}-${idx}`} className="mb-2">
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_DOT[row.signal_level])} />
                    <span className="font-mono text-[9px] text-ink-60 truncate max-w-[110px]">{row.integration}</span>
                  </span>
                  <span className="font-mono text-[9px] tabular-nums text-ink-35">{row.count}</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-paper-2">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", LEVEL_BAR[row.signal_level])}
                    style={{ width: `${Math.round((row.count / maxCount) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
