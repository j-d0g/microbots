"use client";

/**
 * skills window — strength-sorted cards with steps + integration chips.
 *
 * Backed by `GET /api/kg/skills?min_strength=`. The "+1" button posts
 * `POST /api/kg/skills` with `strength_increment=1` so each click
 * tightens the strength counter without overwriting the rest of the
 * record.
 */

import { useCallback, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  getSkills,
  upsertSkill,
  type Skill,
} from "@/lib/kg-client";
import { KgShell, KgHeader } from "./kg-shell";

export function SkillsWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const [minStrength, setMinStrength] = useState<number>(
    (payload?.min_strength as number) ?? 1,
  );

  const seed = (payload?.skills as Skill[] | undefined) ?? null;
  const fetcher = useCallback(
    (signal: AbortSignal) => getSkills({ minStrength }, userId, signal),
    [minStrength, userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);
  const list = data ?? [];

  const bump = async (s: Skill) => {
    try {
      await upsertSkill(
        {
          slug: s.slug,
          name: s.name,
          description: s.description,
          strength_increment: 1,
        },
        userId,
      );
      refetch();
    } catch {
      /* swallow — UI stays stable; user can hit "retry" via refresh */
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="skills"
        right={
          <span className="font-mono text-[10px] text-ink-35">
            {list.length} · ≥ {minStrength}
          </span>
        }
      />

      <div className="flex shrink-0 items-center gap-2 border-b border-rule/40 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
          min strength
        </span>
        <input
          type="range"
          min={1}
          max={20}
          value={minStrength}
          onChange={(e) => setMinStrength(Number(e.target.value))}
          className="flex-1 accent-accent-indigo"
        />
        <span className="w-6 text-right font-mono text-[10px] text-ink-90">
          {minStrength}
        </span>
      </div>

      <div className="muji-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <KgShell
          loading={loading}
          error={error}
          empty={list.length === 0}
          emptyHint="skills accumulate as the agent learns reusable steps."
          onRetry={refetch}
        >
          <ul className="space-y-2">
            {list.map((s) => (
              <li
                key={s.id}
                className="rounded border border-rule/50 bg-paper-2/30 p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-[12px] text-ink-90">{s.name}</p>
                  <button
                    type="button"
                    onClick={() => bump(s)}
                    className="font-mono text-[10px] text-accent-indigo hover:underline"
                    title="POST /api/kg/skills · strength_increment=1"
                  >
                    +1
                  </button>
                </div>
                <p className="mt-0.5 font-mono text-[11px] leading-snug text-ink-60">
                  {s.description}
                </p>
                {s.steps.length > 0 && (
                  <ol className="mt-2 list-inside list-decimal space-y-0.5 font-mono text-[10px] text-ink-60">
                    {s.steps.slice(0, 6).map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] text-accent-indigo">
                    strength ×{s.strength}
                  </span>
                  {s.frequency && (
                    <span className="font-mono text-[9px] text-ink-35">
                      · {s.frequency}
                    </span>
                  )}
                  {s.integrations.map((slug) => (
                    <span
                      key={slug}
                      className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[9px] text-ink-35"
                    >
                      {slug}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </KgShell>
      </div>
    </div>
  );
}
