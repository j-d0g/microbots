"use client";

import { useCallback, useMemo } from "react";
import { GitBranch } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { getWorkflows, type Workflow } from "@/lib/kg-client";
import { cn } from "@/lib/cn";

function isActive(w: Workflow): boolean {
  return w.skill_chain.length > 0 && !!w.trigger;
}

export function WorkflowsSideline({ win }: { win: WindowState }) {
  const userId = useAgentStore((s) => s.userId);
  const seed = (win.payload?.workflows as Workflow[] | undefined) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) => getWorkflows(userId, signal),
    [userId],
  );

  const { data, loading } = useKgResource(fetcher, seed);
  const list = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.slug.localeCompare(b.slug)),
    [data],
  );
  const activeCount = list.filter(isActive).length;

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-baseline justify-between border-b border-rule/40 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-35">
          playbooks
        </span>
        <span className="font-mono text-[10px] text-ink-60">
          {loading && list.length === 0 ? <span className="text-ink-35">…</span> : list.length}
        </span>
      </div>

      {list.length > 0 && (
        <div className="flex items-center gap-2 border-b border-rule/30 px-3 py-1.5">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-indigo" />
            <span className="font-mono text-[9px] text-ink-60">{activeCount} active</span>
          </span>
          <span className="font-mono text-[9px] text-ink-35">·</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-ink-35/60" />
            <span className="font-mono text-[9px] text-ink-35">{list.length - activeCount} draft</span>
          </span>
        </div>
      )}

      <div className="muji-scroll min-h-0 flex-1 overflow-y-auto">
        {loading && list.length === 0 && (
          <div className="px-3 py-3">
            <p className="font-mono text-[10px] text-ink-35">loading…</p>
          </div>
        )}
        {!loading && list.length === 0 && (
          <div className="flex flex-col items-start gap-1 px-3 py-4">
            <GitBranch size={14} strokeWidth={1.4} className="mb-1 text-ink-35/50" />
            <p className="font-mono text-[10px] leading-relaxed text-ink-35">no playbooks yet.</p>
          </div>
        )}
        {list.length > 0 && (
          <ul className="divide-y divide-rule/30">
            {list.map((w) => {
              const active = isActive(w);
              return (
                <li key={w.slug} className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <div className="mt-[3px] flex shrink-0 flex-col items-center gap-1">
                      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent-indigo" : "bg-ink-35/50")} />
                      <GitBranch size={9} strokeWidth={1.6} className={cn(active ? "text-accent-indigo/70" : "text-ink-35/50")} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate font-mono text-[10px] leading-tight", active ? "text-ink-90" : "text-ink-60")}>
                        {w.name}
                      </p>
                      <p className="truncate font-mono text-[9px] leading-tight text-ink-35">{w.slug}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded bg-paper-2/70 px-1 py-px font-mono text-[8px] text-ink-35">
                          {w.skill_chain.length} step{w.skill_chain.length !== 1 ? "s" : ""}
                        </span>
                        {w.trigger && (
                          <span className="rounded bg-accent-indigo-soft px-1 py-px font-mono text-[8px] text-accent-indigo/80">
                            {w.trigger.length > 14 ? w.trigger.slice(0, 13) + "…" : w.trigger}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-rule/30 px-3 py-1.5">
        <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-ink-35/60">
          workflows · kg
        </span>
      </div>
    </div>
  );
}
