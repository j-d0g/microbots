"use client";

/**
 * integrations window — alphabetical browser of `Integration[]`.
 *
 * Backed by `GET /api/kg/integrations`. Click a card → opens
 * `integration_detail` with that slug.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { getIntegrations, type Integration } from "@/lib/kg-client";
import { registerTools } from "@/lib/room-tools";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

type IntegrationsSort = "name" | "usage";

export function IntegrationsWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const openWindow = useAgentStore((s) => s.openWindow);
  /* Agent-driven filter / sort state. Empty strings clear the
   * filter; sort defaults to alphabetical-by-name to match the
   * pre-agent layout. */
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<IntegrationsSort>("name");

  const seed = (payload?.integrations as Integration[] | undefined) ?? null;
  const fetcher = useCallback(
    (signal: AbortSignal) => getIntegrations(userId, signal),
    [userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);

  const list = useMemo(() => {
    const all = data ?? [];
    const q = searchQuery.trim().toLowerCase();
    const cat = categoryFilter.trim().toLowerCase();
    const filtered = all.filter((it) => {
      if (q) {
        const hay = `${it.name} ${it.slug} ${it.user_purpose ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (cat) {
        if ((it.category ?? "").toLowerCase() !== cat) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === "usage") {
        /* Usage proxy: longer co_used list ⇒ more co-used.
         * Tie-break alphabetically. */
        const au = (a.co_used_with_slugs ?? []).length;
        const bu = (b.co_used_with_slugs ?? []).length;
        if (au !== bu) return bu - au;
      }
      return a.slug.localeCompare(b.slug);
    });
  }, [data, searchQuery, categoryFilter, sortBy]);

  /* Register UI handlers so the orchestrator's `integrations_*`
   * tools actually move the canvas. Without this every search /
   * filter / sort call from the agent silently no-ops in
   * `callRoomTool`. */
  useEffect(() => {
    return registerTools("integrations", [
      {
        name: "list_all",
        description: "Refresh integrations and clear all filters.",
        run: () => {
          setSearchQuery("");
          setCategoryFilter("");
          setSortBy("name");
          refetch();
        },
      },
      {
        name: "refresh_list",
        description: "Refetch the integration list from the backend.",
        run: () => {
          refetch();
        },
      },
      {
        name: "search",
        description: "Filter integrations by free-text query (name + purpose). Empty clears.",
        args: { query: "string" },
        run: (args) => {
          setSearchQuery(typeof args.query === "string" ? args.query : "");
        },
      },
      {
        name: "filter_by_category",
        description: "Restrict the list to one category. Empty string clears.",
        args: { category: "string" },
        run: (args) => {
          setCategoryFilter(typeof args.category === "string" ? args.category : "");
        },
      },
      {
        name: "sort_by_name",
        description: "Sort the list alphabetically by slug.",
        run: () => setSortBy("name"),
      },
      {
        name: "sort_by_usage",
        description: "Sort by usage proxy (co-used count, descending).",
        run: () => setSortBy("usage"),
      },
      {
        name: "count_active",
        description:
          "Narration hook — agent reads list length back to user. No mutation.",
        run: () => {
          /* Pure read; the count is already visible in the header. */
        },
      },
      {
        name: "read_co_used",
        description: "Narration hook — agent describes co-used relationships.",
        run: () => {
          /* Pure read; co-used chips are rendered on each card. */
        },
      },
    ]);
  }, [refetch]);

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
