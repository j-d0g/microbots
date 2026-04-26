"use client";

/**
 * entities window — entity-type tabs + filtered list of `Entity[]`.
 *
 * Backed by `GET /api/kg/entity-types` + `GET /api/kg/entities?entity_type=…`.
 * Row click → `entity_detail`. Footer button POSTs `/entities` for
 * quick-add upserts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  getEntities,
  getEntityTypes,
  upsertEntity,
  type Entity,
  type EntityTypeCount,
} from "@/lib/kg-client";
import { registerTools } from "@/lib/room-tools";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

type EntitiesSort = "alpha" | "mentions";

export function EntitiesWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const openWindow = useAgentStore((s) => s.openWindow);

  const [activeType, setActiveType] = useState<string>(
    (payload?.entity_type as string) ?? "",
  );
  const seedTypes = (payload?.types as EntityTypeCount[] | undefined) ?? null;
  const seedRows = (payload?.entities as Entity[] | undefined) ?? null;

  const typesFetcher = useCallback(
    (signal: AbortSignal) => getEntityTypes(userId, signal),
    [userId],
  );
  const rowsFetcher = useCallback(
    (signal: AbortSignal) =>
      activeType
        ? getEntities(activeType, userId, signal)
        : Promise.resolve([] as Entity[]),
    [activeType, userId],
  );

  const types = useKgResource(typesFetcher, seedTypes);
  const rows = useKgResource(rowsFetcher, seedRows);

  // Auto-select the most-populous type when the list lands and we
  // don't yet have a selection.
  const typeList = types.data ?? [];
  if (!activeType && typeList.length > 0) {
    // Defer to next tick to avoid setState-during-render warning.
    queueMicrotask(() => {
      if (!activeType) setActiveType(typeList[0].entity_type);
    });
  }

  const [adding, setAdding] = useState(false);
  /* Agent-driven filter / sort state. */
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [minMentions, setMinMentions] = useState<number>(0);
  const [sortMode, setSortMode] = useState<EntitiesSort>("alpha");

  const visibleRows = useMemo(() => {
    const all = rows.data ?? [];
    const q = searchQuery.trim().toLowerCase();
    const tag = tagFilter.trim().toLowerCase();
    const filtered = all.filter((e) => {
      if (q) {
        const aliasHit = e.aliases.some((a) => a.toLowerCase().includes(q));
        if (!e.name.toLowerCase().includes(q) && !aliasHit) return false;
      }
      if (tag) {
        if (!e.tags.some((t) => t.toLowerCase() === tag)) return false;
      }
      if (minMentions > 0 && e.chat_mention_count < minMentions) return false;
      return true;
    });
    return [...filtered].sort((a, b) =>
      sortMode === "mentions"
        ? b.chat_mention_count - a.chat_mention_count
        : a.name.localeCompare(b.name),
    );
  }, [rows.data, searchQuery, tagFilter, minMentions, sortMode]);

  /* Register UI handlers. Tool names match what
   * `lib/agent/window-tools/entities.ts` emits via
   * `dispatchToEntities` (un-prefixed). */
  useEffect(() => {
    return registerTools("entities", [
      {
        name: "switch_type_tab",
        description: "Switch the active entity-type tab.",
        args: { entity_type: "string" },
        run: (args) => {
          if (typeof args.entity_type === "string" && args.entity_type) {
            setActiveType(args.entity_type);
          }
        },
      },
      {
        name: "list_by_type",
        description: "Switch tab + refetch the list for that type.",
        args: { entity_type: "string" },
        run: (args) => {
          if (typeof args.entity_type === "string" && args.entity_type) {
            setActiveType(args.entity_type);
          }
          rows.refetch();
        },
      },
      {
        name: "search",
        description: "Free-text search by name or alias. Empty clears.",
        args: { query: "string" },
        run: (args) => {
          setSearchQuery(typeof args.query === "string" ? args.query : "");
        },
      },
      {
        name: "find_by_name",
        description: "Same as search — fuzzy by name.",
        args: { query: "string" },
        run: (args) => {
          setSearchQuery(typeof args.query === "string" ? args.query : "");
        },
      },
      {
        name: "find_people",
        description: "Switch to the person tab and clear filters.",
        run: () => {
          setActiveType("person");
          setSearchQuery("");
          setTagFilter("");
          setMinMentions(0);
        },
      },
      {
        name: "filter_by_tag",
        description: "Restrict list to entities carrying this tag. Empty clears.",
        args: { tag: "string" },
        run: (args) => {
          setTagFilter(typeof args.tag === "string" ? args.tag : "");
        },
      },
      {
        name: "filter_by_mention_count",
        description:
          "Restrict to entities with at least N chat mentions. 0 clears.",
        args: { min: "number" },
        run: (args) => {
          const n = Number(args.min);
          setMinMentions(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
        },
      },
      {
        name: "sort_alphabetically",
        description: "Sort entities by name.",
        run: () => setSortMode("alpha"),
      },
      {
        name: "sort_by_mentions",
        description: "Sort entities by chat mention count, descending.",
        run: () => setSortMode("mentions"),
      },
      {
        name: "recently_mentioned",
        description: "Switch to mention-count sort and refetch.",
        run: () => {
          setSortMode("mentions");
          rows.refetch();
        },
      },
      {
        name: "refresh_list",
        description: "Refetch the entity list and types.",
        run: () => {
          types.refetch();
          rows.refetch();
        },
      },
      {
        name: "read_types",
        description: "Narration hook — agent reads the entity-type tabs aloud.",
        run: () => {
          /* Tabs are already rendered; pure read. */
        },
      },
      {
        name: "quick_show",
        description:
          "Best-effort drill-in: search by name and open the first match's detail.",
        args: { name: "string" },
        run: (args) => {
          if (typeof args.name !== "string" || !args.name.trim()) return;
          setSearchQuery(args.name);
          /* Defer to next tick so visibleRows re-renders before we
           * pick the top match. */
          queueMicrotask(() => {
            const top = visibleRows[0];
            if (top) {
              openWindow("entity_detail", {
                payload: {
                  id: top.id,
                  name: top.name,
                  entity_type: top.entity_type,
                  seed: top,
                },
              });
            }
          });
        },
      },
      {
        name: "quick_add",
        description: "Open the quick-add row.",
        run: () => setAdding(true),
      },
    ]);
  }, [rows, types, visibleRows, openWindow]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="entities"
        right={
          <span className="font-mono text-[10px] text-ink-35">
            {visibleRows.length} in {activeType || "—"}
          </span>
        }
      />

      {/* type tabs */}
      <div className="muji-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-rule/40 px-3 py-2">
        {typeList.length === 0 && !types.loading && (
          <span className="font-mono text-[10px] text-ink-35">no types</span>
        )}
        {typeList.map((t) => (
          <button
            key={t.entity_type}
            type="button"
            onClick={() => setActiveType(t.entity_type)}
            className={cn(
              "shrink-0 rounded px-2 py-1 font-mono text-[10px] transition-colors",
              activeType === t.entity_type
                ? "bg-accent-indigo text-white"
                : "bg-paper-2 text-ink-60 hover:text-ink-90",
            )}
          >
            {t.entity_type} · {t.count}
          </button>
        ))}
      </div>

      <div className="muji-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <KgShell
          loading={rows.loading}
          error={rows.error || types.error}
          empty={visibleRows.length === 0}
          emptyHint="no entities of this type yet."
          onRetry={() => {
            types.refetch();
            rows.refetch();
          }}
        >
          <ul className="space-y-1.5">
            {visibleRows.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() =>
                    openWindow("entity_detail", {
                      payload: {
                        id: e.id,
                        name: e.name,
                        entity_type: e.entity_type,
                        seed: e,
                      },
                    })
                  }
                  className={cn(
                    "block w-full rounded border border-rule/50 bg-paper-2/30 p-2 text-left",
                    "hover:border-accent-indigo/40 hover:bg-paper-2/60",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[12px] text-ink-90">
                      {e.name}
                    </span>
                    <span className="font-mono text-[9px] text-ink-35">
                      {e.chat_mention_count} mentions
                    </span>
                  </div>
                  {e.aliases.length > 0 && (
                    <p className="font-mono text-[10px] text-ink-60">
                      aka {e.aliases.slice(0, 4).join(", ")}
                    </p>
                  )}
                  {e.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {e.tags.slice(0, 5).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[9px] text-ink-35"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </KgShell>
      </div>

      <div className="shrink-0 border-t border-rule/50">
        {adding ? (
          <QuickAddEntity
            defaultType={activeType}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              types.refetch();
              rows.refetch();
            }}
            userId={userId}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:bg-paper-2/60"
          >
            + quick-add entity
          </button>
        )}
      </div>
    </div>
  );
}

function QuickAddEntity({
  defaultType,
  onCancel,
  onSaved,
  userId,
}: {
  defaultType: string;
  onCancel: () => void;
  onSaved: () => void;
  userId: string | null;
}) {
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState(defaultType || "person");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await upsertEntity({ name: name.trim(), entity_type: entityType }, userId);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 px-3 py-2">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
          className="flex-1 rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 placeholder:text-ink-35 focus:border-accent-indigo/50 focus:outline-none"
        />
        <input
          type="text"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          placeholder="type"
          className="w-24 rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 placeholder:text-ink-35 focus:border-accent-indigo/50 focus:outline-none"
        />
      </div>
      <div className="flex items-center justify-between">
        {err ? (
          <span className="font-mono text-[10px] text-confidence-low">{err}</span>
        ) : (
          <span className="font-mono text-[10px] text-ink-35">
            POST /api/kg/entities
          </span>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-[10px] text-ink-35 hover:text-ink-90"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="font-mono text-[10px] text-accent-indigo hover:underline disabled:opacity-40"
          >
            {busy ? "saving…" : "save"}
          </button>
        </div>
      </div>
    </div>
  );
}
