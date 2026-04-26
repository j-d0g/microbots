"use client";

import { useMemo } from "react";
import { User, Building2, Tag } from "lucide-react";
import { cn } from "@/lib/cn";
import type { WindowState } from "@/lib/store";
import type { Entity, EntityTypeCount } from "@/lib/kg-client";

function entityIcon(entityType: string) {
  const t = entityType.toLowerCase();
  if (t === "person" || t === "people") return User;
  if (t === "org" || t === "organisation" || t === "organization" || t === "company") return Building2;
  return Tag;
}

export function EntitiesSideline({ win }: { win: WindowState }) {
  const payload = win.payload ?? {};

  const entities = useMemo<Entity[]>(() => {
    const raw = payload.entities;
    if (Array.isArray(raw)) return raw as Entity[];
    return [];
  }, [payload.entities]);

  const typeCounts = useMemo<EntityTypeCount[]>(() => {
    const raw = payload.types;
    if (Array.isArray(raw)) return raw as EntityTypeCount[];
    return [];
  }, [payload.types]);

  const total =
    entities.length > 0
      ? entities.length
      : typeCounts.reduce((acc, t) => acc + t.count, 0);

  const isEmpty = entities.length === 0 && typeCounts.length === 0;

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-baseline justify-between px-3 pb-2 pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-60">entities</span>
        <span className="font-mono text-[10px] tabular-nums text-ink-35">
          {total > 0 ? `${total}` : "—"}
        </span>
      </div>

      <div className="hairline mx-3 shrink-0" />

      <div className="min-h-0 flex-1 overflow-hidden">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center px-4 pb-6 pt-4">
            <Tag size={16} strokeWidth={1.4} className="mb-2 text-ink-35 opacity-60" />
            <p className="text-center font-mono text-[10px] leading-relaxed text-ink-35">no entities yet</p>
          </div>
        ) : entities.length > 0 ? (
          <ul className="flex flex-col px-3 py-2">
            {entities.map((e, i) => {
              const Icon = entityIcon(e.entity_type);
              return (
                <li key={e.id}>
                  <div className="flex items-center gap-2 py-[5px]">
                    <Icon size={10} strokeWidth={1.6} className="shrink-0 text-ink-35" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-ink-90" title={e.name}>
                      {e.name}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-ink-35">{e.entity_type}</span>
                  </div>
                  {i < entities.length - 1 && <div className="hairline opacity-50" />}
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="flex flex-col px-3 py-2">
            {typeCounts.map((t, i) => {
              const Icon = entityIcon(t.entity_type);
              return (
                <li key={t.entity_type}>
                  <div className="flex items-center gap-2 py-[5px]">
                    <Icon size={10} strokeWidth={1.6} className="shrink-0 text-ink-35" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-ink-90">
                      {t.entity_type}
                    </span>
                    <span className={cn("shrink-0 rounded-sm bg-accent-indigo-soft px-1 py-0.5 font-mono text-[9px] tabular-nums text-accent-indigo")}>
                      {t.count}
                    </span>
                  </div>
                  {i < typeCounts.length - 1 && <div className="hairline opacity-50" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
