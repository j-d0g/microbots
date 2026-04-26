"use client";

import { useCallback } from "react";
import { Zap, Layers } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { getSkills, type Skill } from "@/lib/kg-client";
import { cn } from "@/lib/cn";

export function SkillsSideline({ win }: { win: WindowState }) {
  const userId = useAgentStore((s) => s.userId);
  const seed = (win.payload?.skills as Skill[] | undefined) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) => getSkills({ minStrength: 1 }, userId, signal),
    [userId],
  );

  const { data, loading } = useKgResource(fetcher, seed);
  const list = data ?? [];

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      {/* Count header */}
      <div className="flex shrink-0 items-center justify-between border-b border-rule/40 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-35">
          capabilities
        </span>
        <span
          className={cn(
            "font-mono text-[10px] text-accent-indigo transition-opacity",
            loading && list.length === 0 ? "opacity-40" : "opacity-100",
          )}
        >
          {loading && list.length === 0 ? "—" : list.length}
        </span>
      </div>

      {/* Skill rows */}
      <div className="muji-scroll min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <Layers size={18} strokeWidth={1.25} className="text-ink-35 opacity-60" />
            <span className="font-mono text-[10px] leading-snug text-ink-35">
              no skills yet
            </span>
          </div>
        ) : (
          <ul>
            {list.map((skill, idx) => (
              <SkillRow key={skill.id} skill={skill} isLast={idx === list.length - 1} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SkillRow({ skill, isLast }: { skill: Skill; isLast: boolean }) {
  return (
    <li className={cn("flex flex-col gap-0.5 px-3 py-2", !isLast && "border-b border-rule/30")}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Zap size={9} strokeWidth={1.75} className="shrink-0 text-accent-indigo opacity-70" />
        <span className="min-w-0 truncate font-mono text-[10px] leading-tight text-ink-90">
          {skill.name}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-[13px]">
        <span className="font-mono text-[9px] text-accent-indigo">×{skill.strength}</span>
        {skill.frequency && (
          <span className="font-mono text-[9px] text-ink-35">{skill.frequency}</span>
        )}
        {skill.integrations.slice(0, 2).map((slug) => (
          <span key={slug} className="rounded bg-paper-2 px-1 py-px font-mono text-[8px] text-ink-35">
            {slug}
          </span>
        ))}
        {skill.integrations.length > 2 && (
          <span className="font-mono text-[8px] text-ink-35">
            +{skill.integrations.length - 2}
          </span>
        )}
      </div>
    </li>
  );
}
