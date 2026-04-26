"use client";

import { useCallback } from "react";
import { Brain } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { getMemories, type Memory } from "@/lib/kg-client";
import { cn } from "@/lib/cn";

function confidenceLevel(c: number): "high" | "med" | "low" {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "med";
  return "low";
}

const DOT_CLASS: Record<"high" | "med" | "low", string> = {
  high: "bg-confidence-high",
  med: "bg-confidence-med",
  low: "bg-confidence-low",
};

export function MemoriesSideline({ win }: { win: WindowState }) {
  const userId = useAgentStore((s) => s.userId);

  const by: "confidence" | "recency" =
    (win.payload?.by as "confidence" | "recency") ?? "confidence";
  const limit = (win.payload?.limit as number) ?? 12;
  const seed = (win.payload?.memories as Memory[] | undefined) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) => getMemories({ by, limit }, userId, signal),
    [by, limit, userId],
  );

  const { data, loading } = useKgResource(fetcher, seed);
  const list: Memory[] = data ?? [];

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      {/* Count header */}
      <div className="flex shrink-0 items-center justify-between border-b border-rule/40 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-60">
          {loading && list.length === 0 ? "—" : `${list.length} facts`}
        </span>
        {loading && (
          <span className="h-1 w-1 animate-pulse rounded-full bg-ink-35" />
        )}
      </div>

      {/* Memory list */}
      <div className="muji-scroll min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && !loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <Brain size={20} strokeWidth={1.25} className="text-ink-35 opacity-50" />
            <span className="font-mono text-[10px] leading-relaxed text-ink-35">
              no memories yet
            </span>
          </div>
        ) : (
          <ul className="divide-y divide-rule/30">
            {list.map((m) => {
              const level = confidenceLevel(m.confidence);
              return (
                <li key={String(m.id)} className="flex gap-2 px-3 py-2.5">
                  <span
                    className={cn(
                      "mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full",
                      DOT_CLASS[level],
                    )}
                  />
                  <p className="line-clamp-2 min-w-0 flex-1 font-mono text-[10px] leading-relaxed text-ink-90">
                    {m.content}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer: sort label */}
      <div className="shrink-0 border-t border-rule/40 px-3 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-widest text-ink-35">
          by {by}
        </span>
      </div>
    </div>
  );
}
