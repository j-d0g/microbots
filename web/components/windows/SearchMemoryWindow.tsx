"use client";

/**
 * search_memory window — query bar + ranked results with snippets.
 *
 * Scope tabs: kg / recent_chats / all.
 * Each hit links to graph slice or chat digest.
 */

import { useState } from "react";
import { cn } from "@/lib/cn";

interface MemoryResult {
  source: string;
  scope: string;
  snippet: string;
  score: number;
}

export function SearchMemoryWindow({ payload }: { payload?: Record<string, unknown> }) {
  const query = (payload?.query as string) ?? "";
  const scope = (payload?.scope as string) ?? "all";
  const count = (payload?.count as number) ?? 0;
  const results = (payload?.results as MemoryResult[]) ?? [];
  const status = (payload?.status as string) ?? "pending";

  const [activeScope, setActiveScope] = useState(scope);
  const scopes = ["all", "kg", "recent_chats"] as const;

  const filtered = activeScope === "all"
    ? results
    : results.filter((r) => r.scope === activeScope);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto muji-scroll p-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
            search_memory
          </p>
          <p className="font-mono text-[10px] text-ink-35">
            {count} result{count !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Query display */}
        {query && (
          <p className="font-mono text-[12px] text-ink-90 mb-3">
            q: &quot;{query}&quot;
          </p>
        )}

        {/* Scope tabs */}
        <div className="flex gap-1 mb-3">
          {scopes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setActiveScope(s)}
              className={cn(
                "font-mono text-[10px] px-2 py-1 rounded",
                "transition-colors duration-150",
                activeScope === s
                  ? "bg-accent-indigo text-white"
                  : "bg-paper-2 text-ink-35 hover:text-ink-60",
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Results */}
        {filtered.length === 0 ? (
          <p className="font-mono text-[12px] text-ink-35 text-center py-8">
            no results
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((r, i) => (
              <li
                key={`${r.source}-${i}`}
                className="px-3 py-2 rounded border border-rule/50 bg-paper-2/30"
              >
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-mono text-[10px] text-accent-indigo">
                    {r.source}
                  </span>
                  <span className="font-mono text-[9px] text-ink-35">
                    {r.scope} &middot; {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="font-mono text-[11px] text-ink-60 leading-relaxed">
                  {r.snippet}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-rule/50 px-3 py-2">
        <span className="font-mono text-[10px] text-ink-35">
          try: &quot;what did I discuss with Desmond?&quot;
        </span>
      </div>
    </div>
  );
}
