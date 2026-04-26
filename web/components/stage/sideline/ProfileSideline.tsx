"use client";

import { useCallback } from "react";
import { User } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { getUser } from "@/lib/kg-client";
import { cn } from "@/lib/cn";

export function ProfileSideline({ win }: { win: WindowState }) {
  const userId = useAgentStore((s) => s.userId);
  const seed = win.payload?.user ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) => getUser(userId, signal),
    [userId],
  );

  const { data, loading } = useKgResource(fetcher, seed as never);
  const profile = data;

  if (loading && !profile) {
    return (
      <div className="pointer-events-none flex h-full flex-col gap-3 px-3 py-3">
        {[40, 28, 60, 52].map((w, i) => (
          <div key={i} className="h-2.5 animate-pulse rounded bg-paper-2" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="pointer-events-none flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
        <User size={18} strokeWidth={1.25} className="text-ink-35 opacity-50" />
        <p className="font-mono text-[10px] text-ink-35">no profile yet</p>
      </div>
    );
  }

  const counters = [
    { label: "memories", value: profile.memory_count },
    { label: "skills", value: profile.skill_count },
    { label: "workflows", value: profile.workflow_count },
    { label: "entities", value: profile.entity_count },
  ].filter((c) => c.value > 0);

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden px-3 py-3">
      {/* Identity */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {profile.name && (
            <p className="truncate font-mono text-[13px] font-medium leading-tight text-ink-90">
              {profile.name}
            </p>
          )}
          {profile.role && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink-60">{profile.role}</p>
          )}
        </div>
        <div className="shrink-0 rounded-full bg-accent-indigo-soft p-1.5">
          <User size={10} strokeWidth={1.75} className="text-accent-indigo" />
        </div>
      </div>

      {profile.goals.length > 0 && (
        <>
          <div className="hairline my-2.5 shrink-0" />
          <div className="min-h-0 flex-1 overflow-hidden">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.10em] text-ink-35">goals</p>
            <ul className="space-y-1">
              {profile.goals.slice(0, 4).map((g, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-ink-35" />
                  <span className="line-clamp-2 font-mono text-[10px] leading-relaxed text-ink-90">{g}</span>
                </li>
              ))}
              {profile.goals.length > 4 && (
                <li className="font-mono text-[9px] text-ink-35">+{profile.goals.length - 4} more</li>
              )}
            </ul>
          </div>
        </>
      )}

      {counters.length > 0 && (
        <>
          <div className="hairline my-2.5 shrink-0" />
          <div className={cn("grid shrink-0 gap-x-3 gap-y-1.5", counters.length <= 2 ? "grid-cols-2" : "grid-cols-2")}>
            {counters.map((c) => (
              <div key={c.label}>
                <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-35">{c.label}</p>
                <p className="font-mono text-[11px] tabular-nums text-ink-90">{c.value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {profile.context_window && (
        <>
          <div className="hairline my-2.5 shrink-0" />
          <div className="shrink-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-35">context window</p>
            <p className="font-mono text-[11px] tabular-nums text-ink-90">
              {profile.context_window.toLocaleString()} tokens
            </p>
          </div>
        </>
      )}
    </div>
  );
}
