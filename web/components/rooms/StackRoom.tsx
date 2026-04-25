"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { seed } from "@/lib/seed/ontology";
import { Hairline } from "@/components/primitives/Hairline";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import { cn } from "@/lib/cn";

type Health = "ok" | "warn" | "down";
type HealthFilter = "all" | Health;

const HEALTH_DOT: Record<Health, string> = {
  ok: "bg-confidence-high",
  warn: "bg-confidence-med",
  down: "bg-confidence-low",
};

const HEALTH_LABEL: Record<HealthFilter, string> = {
  all: "all",
  ok: "ok",
  warn: "warn",
  down: "down",
};

export function StackRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.stack);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [highlight, setHighlight] = useState<string | null>(null);

  const blockRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const drawerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return seed.services.filter((s) =>
      healthFilter === "all" ? true : s.health === healthFilter,
    );
  }, [healthFilter]);

  const columns = useMemo(() => {
    const cols: Record<number, typeof seed.services> = {};
    for (const s of filtered) {
      (cols[s.column] ??= []).push(s);
    }
    return cols;
  }, [filtered]);

  const totalsByHealth = useMemo(() => {
    return seed.services.reduce(
      (acc, s) => {
        acc[s.health as Health] = (acc[s.health as Health] ?? 0) + 1;
        return acc;
      },
      { ok: 0, warn: 0, down: 0 } as Record<Health, number>,
    );
  }, []);

  const scrollToSlug = useCallback((slug: string) => {
    const el = blockRefs.current[slug];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(slug);
    window.setTimeout(() => setHighlight(null), 1400);
  }, []);

  const selected = selectedSlug
    ? seed.services.find((s) => s.slug === selectedSlug)
    : null;

  /* ---- agent tools ---- */

  useEffect(() => {
    return registerTools("stack", [
      {
        name: "filter",
        description: "Filter services by health (all|ok|warn|down).",
        args: { health: "all|ok|warn|down" },
        run: (args) => {
          const h = args.health as HealthFilter | undefined;
          if (h === "all" || h === "ok" || h === "warn" || h === "down") {
            setHealthFilter(h);
          }
        },
      },
      {
        name: "clear_filters",
        description: "Reset health filter.",
        run: () => setHealthFilter("all"),
      },
      {
        name: "select",
        description: "Open the service log drawer for a service slug.",
        args: { slug: "service slug, e.g. notion-scribe" },
        run: (args) => {
          const slug = String(args.slug ?? "");
          if (!slug) return;
          setSelectedSlug(slug);
          window.setTimeout(() => {
            drawerRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }, 80);
        },
      },
      {
        name: "deselect",
        description: "Close the service log drawer.",
        run: () => setSelectedSlug(null),
      },
      {
        name: "scroll_to",
        description: "Scroll to a service block by slug and briefly highlight it.",
        args: { slug: "service slug" },
        run: (args) => {
          const slug = String(args.slug ?? "");
          if (slug) scrollToSlug(slug);
        },
      },
      {
        name: "highlight",
        description: "Briefly flash a service block.",
        args: { slug: "service slug" },
        run: (args) => {
          const slug = String(args.slug ?? "");
          if (slug) scrollToSlug(slug);
        },
      },
    ]);
  }, [scrollToSlug]);

  return (
    <RoomStateOverlay room="stack" state={roomState}>
      <div className="@container/stack mx-auto w-full max-w-[1100px]">
        <header className="mb-6 @[640px]/stack:mb-10">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            microservices · {seed.services.length} deployed
          </p>
          <h1
            className="mt-2 font-medium leading-[1.05] tracking-tight text-ink-90"
            style={{ fontSize: "clamp(24px, 5.6cqw, 40px)" }}
          >
            stack.
          </h1>
          <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-ink-60 @[640px]/stack:text-[15px]">
            python microservices. tap a block to read recent logs.
          </p>
        </header>

        <FilterBar
          health={healthFilter}
          setHealth={setHealthFilter}
          totals={totalsByHealth}
          showing={filtered.length}
          total={seed.services.length}
        />

        <div
          className="mt-6 grid grid-cols-1 gap-4 @[640px]/stack:grid-cols-2 @[960px]/stack:grid-cols-3"
          data-testid="stack-grid"
        >
          {Object.values(columns).flat().length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed border-rule px-6 py-10 text-center">
              <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
                no services match
              </p>
              <button
                type="button"
                onClick={() => setHealthFilter("all")}
                className="mt-3 font-mono text-[11px] text-ink-90 underline-offset-4 hover:underline"
              >
                clear filter
              </button>
            </div>
          )}
          {[0, 1, 2].map((col) => {
            const list = columns[col] ?? [];
            if (list.length === 0) return null;
            return (
              <div key={col} className="flex flex-col gap-3">
                {list.map((s) => (
                  <ServiceBlock
                    key={s.slug}
                    service={s}
                    selected={selectedSlug === s.slug}
                    flashing={highlight === s.slug}
                    setRef={(el) => (blockRefs.current[s.slug] = el)}
                    onClick={() =>
                      setSelectedSlug(
                        selectedSlug === s.slug ? null : s.slug,
                      )
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>

        {selected && (
          <div ref={drawerRef} className="mt-8" data-testid="service-drawer">
            <Hairline className="mb-4" />
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  aria-label={`health ${selected.health}`}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    HEALTH_DOT[selected.health as Health],
                  )}
                />
                <h2 className="font-mono text-[12px] text-ink-90">
                  logs · {selected.slug}
                  <span className="ml-2 text-ink-35">@{selected.version}</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSlug(null)}
                className="font-mono text-[11px] text-ink-35 underline-offset-4 hover:text-ink-90 hover:underline"
              >
                close
              </button>
            </div>
            <div
              className="muji-scroll max-h-[320px] overflow-y-auto overflow-x-auto rounded border border-rule bg-ink-90 p-4"
            >
              <pre className="font-mono text-[11px] leading-relaxed text-paper-1 whitespace-pre">
                {selected.logs.join("\n")}
              </pre>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-ink-35">
              <span>schedule: {selected.schedule || "none"}</span>
              <span>runtime: {selected.runtime}</span>
              <span>deployed: {selected.deployedAt}</span>
            </div>
          </div>
        )}
      </div>
    </RoomStateOverlay>
  );
}

function FilterBar({
  health,
  setHealth,
  totals,
  showing,
  total,
}: {
  health: HealthFilter;
  setHealth: (h: HealthFilter) => void;
  totals: Record<Health, number>;
  showing: number;
  total: number;
}) {
  const HEALTHS: HealthFilter[] = ["all", "ok", "warn", "down"];
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-1 border-b border-rule bg-paper-0 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-[5.5rem] shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-35 @[640px]/stack:w-auto">
          health
        </span>
        <div className="flex flex-wrap gap-1.5">
          {HEALTHS.map((h) => {
            const count = h === "all" ? total : totals[h] ?? 0;
            const dot =
              h === "all"
                ? null
                : (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        HEALTH_DOT[h],
                      )}
                    />
                  );
            return (
              <Pill
                key={h}
                active={health === h}
                onClick={() => setHealth(h)}
              >
                {dot}
                {HEALTH_LABEL[h]}
                <span className="text-ink-35 tabular-nums">{count}</span>
              </Pill>
            );
          })}
        </div>
        <span className="ml-auto whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-35">
          {health === "all" ? `${total} services` : `${showing} / ${total}`}
        </span>
      </div>
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
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5",
        "font-mono text-[11px] uppercase tracking-wider",
        "transition-colors duration-150",
        active
          ? "border-ink-90 bg-ink-90 text-paper-0 [&_span]:!text-paper-0/60"
          : "border-rule text-ink-60 hover:bg-paper-1",
      )}
    >
      {children}
    </button>
  );
}

function ServiceBlock({
  service,
  selected,
  flashing,
  setRef,
  onClick,
}: {
  service: (typeof seed.services)[number];
  selected: boolean;
  flashing: boolean;
  setRef: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  return (
    <button
      ref={setRef}
      type="button"
      onClick={onClick}
      data-testid={`service-block-${service.slug}`}
      data-health={service.health}
      data-selected={selected}
      className={cn(
        "relative w-full rounded-lg border bg-paper-1 px-4 py-3 text-left",
        "transition-all duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        "hover:bg-paper-2",
        selected
          ? "border-accent-indigo shadow-[0_0_0_1px_var(--color-accent-indigo)]"
          : flashing
            ? "border-accent-indigo shadow-[0_0_0_2px_var(--color-accent-indigo-soft)]"
            : "border-rule",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate font-mono text-[13px] text-ink-90">
          {service.slug}
          <span className="ml-2 text-ink-35">@{service.version}</span>
        </h3>
        <span
          aria-label={`health ${service.health}`}
          className={cn(
            "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
            HEALTH_DOT[service.health as Health],
          )}
        />
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-60">
        {service.purpose}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-ink-35">
        <span>{service.runtime}</span>
        <span>· {service.deployedAt}</span>
        {service.schedule && <span>· {service.schedule}</span>}
      </div>
    </button>
  );
}
