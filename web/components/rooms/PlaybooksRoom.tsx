"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { seed } from "@/lib/seed/ontology";
import { Chip } from "@/components/primitives/Chip";
import { Hairline } from "@/components/primitives/Hairline";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import { cn } from "@/lib/cn";
import type { PlaybookDef } from "@/lib/seed/types";

type ColumnKey = "org" | "network" | "suggested";
type ColumnFilter = "all" | ColumnKey;

const COLUMN_LABEL: Record<ColumnKey, string> = {
  org: "your org",
  network: "network",
  suggested: "suggested for you",
};

const ALL_PB_INTEGRATIONS = Array.from(
  new Set(
    [
      ...seed.playbooks.org,
      ...seed.playbooks.network,
      ...seed.playbooks.suggested,
    ].flatMap((p) => p.integrations),
  ),
).sort();

type FlatPB = PlaybookDef & { col: ColumnKey };

export function PlaybooksRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.playbooks);
  const pushCard = useAgentStore((s) => s.pushCard);

  const [columnFilter, setColumnFilter] = useState<ColumnFilter>("all");
  const [integration, setIntegration] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const allFlat: FlatPB[] = useMemo(() => {
    return [
      ...seed.playbooks.org.map((p) => ({ ...p, col: "org" as const })),
      ...seed.playbooks.network.map((p) => ({ ...p, col: "network" as const })),
      ...seed.playbooks.suggested.map((p) => ({
        ...p,
        col: "suggested" as const,
      })),
    ];
  }, []);

  const filtered = useMemo(() => {
    return allFlat.filter((p) => {
      if (columnFilter !== "all" && p.col !== columnFilter) return false;
      if (integration && !p.integrations.includes(integration)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !p.title.toLowerCase().includes(q) &&
          !p.oneLiner.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [allFlat, columnFilter, integration, search]);

  const grouped = useMemo(() => {
    const out: Record<ColumnKey, FlatPB[]> = {
      org: [],
      network: [],
      suggested: [],
    };
    for (const p of filtered) out[p.col].push(p);
    return out;
  }, [filtered]);

  const total = allFlat.length;
  const showing = filtered.length;
  const filtersActive =
    columnFilter !== "all" || integration !== null || search !== "";

  const scrollToTitle = useCallback((title: string) => {
    const el = itemRefs.current[title];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(title);
    window.setTimeout(() => setHighlight(null), 1500);
  }, []);

  /* ---- agent tools ---- */

  useEffect(() => {
    return registerTools("playbooks", [
      {
        name: "filter",
        description:
          "Filter playbooks by column (org|network|suggested|all) and/or integration slug.",
        args: {
          column: "all|org|network|suggested",
          integration: "slack|github|... or null",
        },
        run: (args) => {
          const c = args.column as ColumnFilter | undefined;
          if (
            c === "all" ||
            c === "org" ||
            c === "network" ||
            c === "suggested"
          ) {
            setColumnFilter(c);
          }
          if ("integration" in args) {
            const v = args.integration;
            setIntegration(typeof v === "string" && v.length > 0 ? v : null);
          }
        },
      },
      {
        name: "search",
        description: "Substring search by title or one-liner. Empty clears.",
        args: { query: "string" },
        run: (args) => setSearch(typeof args.query === "string" ? args.query : ""),
      },
      {
        name: "clear_filters",
        description: "Reset all filters and search.",
        run: () => {
          setColumnFilter("all");
          setIntegration(null);
          setSearch("");
        },
      },
      {
        name: "scroll_to",
        description: "Scroll to a playbook by title and flash it.",
        args: { title: "playbook title" },
        run: (args) => {
          const t = String(args.title ?? "");
          if (t) scrollToTitle(t);
        },
      },
      {
        name: "highlight",
        description: "Briefly flash a playbook by title to direct attention.",
        args: { title: "playbook title" },
        run: (args) => {
          const t = String(args.title ?? "");
          if (t) scrollToTitle(t);
        },
      },
      {
        name: "try_tonight",
        description: "Stage a playbook for overnight shadow deploy (toast).",
        args: { title: "playbook title" },
        run: (args) => {
          const t = String(args.title ?? "");
          if (!t) return;
          pushCard({
            id: `toast-pb-${t}-${Date.now()}`,
            kind: "toast",
            data: { text: `Queued "${t.slice(0, 40)}" for tonight.` },
            ttl: 4000,
          });
        },
      },
    ]);
  }, [pushCard, scrollToTitle]);

  return (
    <RoomStateOverlay room="playbooks" state={roomState}>
      <div className="@container/playbooks mx-auto w-full max-w-[1200px]">
        <header className="mb-6 @[640px]/playbooks:mb-10">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            playbooks · internet of intelligence · {total} available
          </p>
          <h1
            className="mt-2 font-medium leading-[1.05] tracking-tight text-ink-90"
            style={{ fontSize: "clamp(24px, 5.6cqw, 40px)" }}
          >
            playbooks.
          </h1>
          <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-ink-60 @[640px]/playbooks:text-[15px]">
            your org, the network, and matched suggestions. nothing deploys
            without your approval.
          </p>
        </header>

        <FilterBar
          columnFilter={columnFilter}
          setColumnFilter={setColumnFilter}
          integration={integration}
          setIntegration={setIntegration}
          search={search}
          setSearch={setSearch}
          showing={showing}
          total={total}
          active={filtersActive}
        />

        {filtered.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-rule px-6 py-12 text-center">
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
              no playbooks match
            </p>
            <button
              type="button"
              onClick={() => {
                setColumnFilter("all");
                setIntegration(null);
                setSearch("");
              }}
              className="mt-3 font-mono text-[11px] text-ink-90 underline-offset-4 hover:underline"
            >
              clear filters
            </button>
          </div>
        ) : (
          <div
            className="mt-6 grid gap-x-8 gap-y-10 grid-cols-1 @[768px]/playbooks:grid-cols-2 @[1100px]/playbooks:grid-cols-3"
            data-testid="playbooks-columns"
          >
            {(["org", "network", "suggested"] as ColumnKey[]).map((col) => {
              const list = grouped[col];
              if (list.length === 0) return null;
              return (
                <Column
                  key={col}
                  title={COLUMN_LABEL[col]}
                  tone={col === "suggested" ? "accent" : "neutral"}
                  items={list}
                  highlight={highlight}
                  itemRef={(title, el) => (itemRefs.current[title] = el)}
                />
              );
            })}
          </div>
        )}

        <Hairline className="mt-12" />
        <p className="mt-4 mb-2 font-mono text-[11px] text-ink-35">
          say &ldquo;try the standup assembler tonight&rdquo; to shadow deploy.
        </p>
      </div>
    </RoomStateOverlay>
  );
}

function FilterBar({
  columnFilter,
  setColumnFilter,
  integration,
  setIntegration,
  search,
  setSearch,
  showing,
  total,
  active,
}: {
  columnFilter: ColumnFilter;
  setColumnFilter: (c: ColumnFilter) => void;
  integration: string | null;
  setIntegration: (v: string | null) => void;
  search: string;
  setSearch: (v: string) => void;
  showing: number;
  total: number;
  active: boolean;
}) {
  const COLS: ColumnFilter[] = ["all", "org", "network", "suggested"];
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-1 border-b border-rule bg-paper-0 px-4 py-3">
      <div className="flex flex-col gap-2 @[768px]/playbooks:flex-row @[768px]/playbooks:items-center @[768px]/playbooks:gap-x-4">
        <FilterRow label="column">
          {COLS.map((c) => (
            <Pill
              key={c}
              active={columnFilter === c}
              onClick={() => setColumnFilter(c)}
            >
              {c === "all"
                ? "all"
                : c === "suggested"
                  ? "suggested"
                  : COLUMN_LABEL[c as ColumnKey]}
            </Pill>
          ))}
        </FilterRow>
        <FilterRow label="integration">
          <Pill
            active={integration === null}
            onClick={() => setIntegration(null)}
          >
            any
          </Pill>
          {ALL_PB_INTEGRATIONS.map((i) => (
            <Pill
              key={i}
              active={integration === i}
              onClick={() => setIntegration(integration === i ? null : i)}
            >
              {i}
            </Pill>
          ))}
        </FilterRow>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search…"
            data-testid="playbooks-search"
            className={cn(
              "h-7 rounded-sm border border-rule bg-paper-0 px-2",
              "font-mono text-[11px] text-ink-90 placeholder:text-ink-35",
              "outline-none focus:border-ink-90 transition-colors",
              "w-full @[768px]/playbooks:w-40",
            )}
          />
          <span className="ml-auto whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-35">
            {active ? `${showing} / ${total}` : `${total}`}
          </span>
        </div>
      </div>
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-[5.5rem] shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-35 @[768px]/playbooks:w-auto">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className={cn(
        "rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider",
        "transition-colors duration-150",
        active
          ? "border-ink-90 bg-ink-90 text-paper-0"
          : "border-rule text-ink-60 hover:bg-paper-1",
      )}
    >
      {children}
    </button>
  );
}

function Column({
  title,
  items,
  tone,
  highlight,
  itemRef,
}: {
  title: string;
  items: PlaybookDef[];
  tone: "neutral" | "accent";
  highlight: string | null;
  itemRef: (title: string, el: HTMLLIElement | null) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          {title}
        </h2>
        <Chip tone={tone}>{items.length}</Chip>
      </div>
      <ul className="space-y-3">
        {items.map((p) => (
          <li
            key={p.title}
            ref={(el) => itemRef(p.title, el)}
            data-testid={`playbook-${p.title}`}
            className={cn(
              "rounded-lg border bg-paper-1 px-4 py-4 transition-all duration-200",
              highlight === p.title
                ? "border-accent-indigo shadow-[0_0_0_2px_var(--color-accent-indigo-soft)]"
                : "border-rule",
            )}
          >
            <h3 className="text-[15px] font-medium leading-snug text-ink-90">
              {p.title}
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-60">
              {p.oneLiner}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.integrations.map((i) => (
                <Chip key={i} tone="neutral">
                  {i}
                </Chip>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                className="font-mono text-[11px] text-ink-90 underline-offset-4 hover:underline"
              >
                try tonight →
              </button>
              {p.adoption !== undefined && (
                <span className="font-mono text-[10px] text-ink-35">
                  {p.adoption} org{p.adoption !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
