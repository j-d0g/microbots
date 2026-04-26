"use client";

import { Tag } from "lucide-react";
import { cn } from "@/lib/cn";
import type { WindowState } from "@/lib/store";

interface EntityPayload {
  id?: string;
  name?: string;
  entity_type?: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  chat_mention_count?: number;
  appears_in_edges?: { integration_slug: string; handle?: string; role?: string }[];
  mentions?: { chat_id: string; title?: string; source_type: string; mention_type: string }[];
}

function PropRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 font-mono text-[9px] uppercase leading-none tracking-[0.08em] text-ink-35">
        {label}
      </p>
      <div className="font-mono text-[11px] leading-snug text-ink-90 break-words">{value}</div>
      <div className="hairline mt-2" />
    </div>
  );
}

export function EntityDetailSideline({ win }: { win: WindowState }) {
  const p = (win.payload ?? {}) as EntityPayload;
  const name = p.name ?? (typeof p.id === "string" ? p.id : null);
  const entityType = p.entity_type ?? null;
  const description = p.description ?? null;
  const aliases = p.aliases ?? [];
  const tags = p.tags ?? [];
  const mentionCount = p.chat_mention_count ?? p.mentions?.length ?? null;
  const edgeCount = p.appears_in_edges?.length ?? null;

  if (!name) {
    return (
      <div className="pointer-events-none flex h-full flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
        <Tag size={14} strokeWidth={1.5} className="text-ink-35 opacity-60" aria-hidden />
        <p className="font-mono text-[10px] text-ink-35">no entity loaded</p>
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex h-full flex-col gap-3 overflow-hidden px-3 py-3">
      {/* Identity */}
      <div className="shrink-0">
        <p className="break-words font-mono text-[13px] font-medium leading-tight text-ink-90">{name}</p>
        {entityType && (
          <span className={cn("mt-1 inline-block rounded bg-accent-indigo-soft px-1.5 py-0.5", "font-mono text-[9px] uppercase tracking-[0.08em] text-accent-indigo")}>
            {entityType}
          </span>
        )}
      </div>

      <div className="hairline shrink-0" />

      {/* Properties */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {description && (
          <PropRow
            label="description"
            value={<span className="line-clamp-3 font-mono text-[10px] leading-relaxed text-ink-60">{description}</span>}
          />
        )}
        {mentionCount !== null && (
          <PropRow
            label="mentions"
            value={mentionCount === 0 ? <span className="text-ink-35">none yet</span> : String(mentionCount)}
          />
        )}
        {edgeCount !== null && edgeCount > 0 && (
          <PropRow label="integrations" value={String(edgeCount)} />
        )}
        {aliases.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[9px] uppercase leading-none tracking-[0.08em] text-ink-35">aliases</p>
            <div className="flex flex-wrap gap-1">
              {aliases.slice(0, 4).map((a) => (
                <span key={a} className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[9px] text-ink-60">{a}</span>
              ))}
              {aliases.length > 4 && <span className="font-mono text-[9px] text-ink-35">+{aliases.length - 4}</span>}
            </div>
            <div className="hairline mt-2" />
          </div>
        )}
        {tags.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[9px] uppercase leading-none tracking-[0.08em] text-ink-35">tags</p>
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 5).map((t) => (
                <span key={t} className="rounded bg-accent-indigo-soft px-1.5 py-0.5 font-mono text-[9px] text-accent-indigo">#{t}</span>
              ))}
              {tags.length > 5 && <span className="font-mono text-[9px] text-ink-35">+{tags.length - 5}</span>}
            </div>
          </div>
        )}
        {p.appears_in_edges && p.appears_in_edges.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[9px] uppercase leading-none tracking-[0.08em] text-ink-35">appears in</p>
            <ul className="space-y-1">
              {p.appears_in_edges.slice(0, 3).map((edge, i) => (
                <li key={`${edge.integration_slug}-${i}`} className="flex items-baseline justify-between rounded border border-rule/50 bg-paper-2/30 px-2 py-0.5">
                  <span className="max-w-[120px] truncate font-mono text-[10px] text-ink-90">
                    {edge.integration_slug}
                    {edge.role && <span className="text-ink-35"> · {edge.role}</span>}
                  </span>
                  {edge.handle && (
                    <span className="ml-1 shrink-0 font-mono text-[9px] text-ink-60">{edge.handle}</span>
                  )}
                </li>
              ))}
              {p.appears_in_edges.length > 3 && (
                <li className="px-2 font-mono text-[9px] text-ink-35">+{p.appears_in_edges.length - 3} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
