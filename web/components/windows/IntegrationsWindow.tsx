"use client";

/**
 * integrations window — alphabetical browser of `Integration[]`.
 *
 * Backed by `GET /api/kg/integrations`. Click a card → opens
 * `integration_detail` with that slug.
 */

import { useCallback, useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { getIntegrations, type Integration } from "@/lib/kg-client";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

export function IntegrationsWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const openWindow = useAgentStore((s) => s.openWindow);

  const seed = (payload?.integrations as Integration[] | undefined) ?? null;
  const fetcher = useCallback(
    (signal: AbortSignal) => getIntegrations(userId, signal),
    [userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);

  const list = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.slug.localeCompare(b.slug)),
    [data],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="integrations"
        right={
          <span className="font-mono text-[10px] text-ink-35">
            {list.length} connected
          </span>
        }
      />
      <div className="muji-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <KgShell
          loading={loading}
          error={error}
          empty={list.length === 0}
          emptyHint="connect a tool from settings to see it here."
          onRetry={refetch}
        >
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {list.map((it) => (
              <li key={it.slug}>
                <button
                  type="button"
                  onClick={() =>
                    openWindow("integration_detail", {
                      payload: { slug: it.slug, seed: it },
                    })
                  }
                  className={cn(
                    "block w-full rounded border border-rule/50 bg-paper-2/30 p-3 text-left",
                    "transition-all duration-150",
                    "hover:border-accent-indigo/40 hover:bg-paper-2/60",
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[12px] text-ink-90">
                      {it.name}
                    </span>
                    {it.category && (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
                        {it.category}
                      </span>
                    )}
                  </div>
                  {it.user_purpose && (
                    <p className="mt-1 font-mono text-[11px] leading-snug text-ink-60 line-clamp-2">
                      {it.user_purpose}
                    </p>
                  )}
                  {(() => {
                    /* The backend returns `{ out: { slug } }[]` even though
                     * the kg-client type still claims `Slug[]`. Normalize
                     * defensively so we accept either shape and never feed
                     * an object into React's `key`. */
                    const slugs = (it.co_used_with_slugs ?? [])
                      .map((s: unknown) =>
                        typeof s === "string"
                          ? s
                          : (s as { out?: { slug?: string } })?.out?.slug ?? "",
                      )
                      .filter((s): s is string => s.length > 0);
                    if (slugs.length === 0) return null;
                    return (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {slugs.slice(0, 4).map((s) => (
                          <span
                            key={s}
                            className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[9px] text-ink-35"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </button>
              </li>
            ))}
          </ul>
        </KgShell>
      </div>
    </div>
  );
}
