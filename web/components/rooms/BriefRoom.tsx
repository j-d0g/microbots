"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { seed } from "@/lib/seed/ontology";
import { Chip } from "@/components/primitives/Chip";
import { Button } from "@/components/primitives/Button";
import { Hairline } from "@/components/primitives/Hairline";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import { cn } from "@/lib/cn";

type Tone = "high" | "med" | "low";
type ToneFilter = "all" | Tone;

function confidenceTone(c: number): Tone {
  if (c >= 0.9) return "high";
  if (c >= 0.7) return "med";
  return "low";
}

const TONE_LABEL: Record<ToneFilter, string> = {
  all: "all",
  high: "high",
  med: "med",
  low: "low",
};

const TONE_TITLE: Record<ToneFilter, string> = {
  all: "show all proposals",
  high: "confidence ≥ 0.9",
  med: "confidence ≥ 0.7",
  low: "confidence < 0.7",
};

const ALL_INTEGRATIONS = Array.from(
  new Set(seed.briefProposals.flatMap((p) => p.integrations)),
).sort();

export function BriefRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.brief);
  const pushCard = useAgentStore((s) => s.pushCard);

  const [toneFilter, setToneFilter] = useState<ToneFilter>("all");
  const [integration, setIntegration] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [statuses, setStatuses] = useState<
    Record<string, "pending" | "approved" | "deferred">
  >({});
  const [highlight, setHighlight] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const yesterdayRef = useRef<HTMLElement>(null);

  /* ---- filter logic ---- */

  const filtered = useMemo(() => {
    return seed.briefProposals.filter((p) => {
      if (toneFilter !== "all" && confidenceTone(p.confidence) !== toneFilter) {
        return false;
      }
      if (integration && !p.integrations.includes(integration)) return false;
      return true;
    });
  }, [toneFilter, integration]);

  /* ---- helpers ---- */

  const setStatus = useCallback(
    (id: string, status: "pending" | "approved" | "deferred") => {
      setStatuses((s) => ({ ...s, [id]: status }));
    },
    [],
  );

  const approveProposal = useCallback(
    (id: string) => {
      const p = seed.briefProposals.find((x) => x.id === id);
      setStatus(id, "approved");
      if (p) {
        pushCard({
          id: `toast-approve-${id}`,
          kind: "toast",
          data: { text: `Queued "${p.title.slice(0, 40)}..." for shadow deploy.` },
          ttl: 4000,
        });
      }
    },
    [pushCard, setStatus],
  );

  const scrollTo = useCallback((opts: { id?: string; section?: string }) => {
    if (opts.id) {
      const el = cardRefs.current[opts.id];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlight(opts.id);
      window.setTimeout(() => setHighlight(null), 1400);
      return;
    }
    if (opts.section === "yesterday" || opts.section === "yesterday-runs") {
      yesterdayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (opts.section === "top") {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  /* ---- agent tool registration ---- */

  useEffect(() => {
    return registerTools("brief", [
      {
        name: "filter",
        description:
          "Filter proposals by tone (all|high|med|low) and/or integration slug. Pass null/all to clear.",
        args: { tone: "all|high|med|low (optional)", integration: "slack|github|... or null" },
        run: (args) => {
          const t = args.tone as ToneFilter | undefined;
          if (t && (t === "all" || t === "high" || t === "med" || t === "low")) {
            setToneFilter(t);
          }
          if ("integration" in args) {
            const v = args.integration;
            setIntegration(typeof v === "string" && v.length > 0 ? v : null);
          }
        },
      },
      {
        name: "clear_filters",
        description: "Reset all proposal filters.",
        run: () => {
          setToneFilter("all");
          setIntegration(null);
        },
      },
      {
        name: "expand",
        description: "Expand the recipe of a proposal.",
        args: { id: "proposal id, e.g. bp-001" },
        run: (args) => {
          const id = String(args.id ?? "");
          if (!id) return;
          setExpanded((e) => ({ ...e, [id]: true }));
          window.setTimeout(() => scrollTo({ id }), 30);
        },
      },
      {
        name: "collapse",
        description: "Collapse a proposal recipe.",
        args: { id: "proposal id" },
        run: (args) => {
          const id = String(args.id ?? "");
          if (!id) return;
          setExpanded((e) => ({ ...e, [id]: false }));
        },
      },
      {
        name: "approve",
        description: "Approve a proposal (queues shadow deploy).",
        args: { id: "proposal id" },
        run: (args) => {
          const id = String(args.id ?? "");
          if (id) approveProposal(id);
        },
      },
      {
        name: "defer",
        description: "Defer a proposal until later.",
        args: { id: "proposal id" },
        run: (args) => {
          const id = String(args.id ?? "");
          if (id) setStatus(id, "deferred");
        },
      },
      {
        name: "scroll_to",
        description:
          "Scroll the brief to a proposal id or to a named section (yesterday|top).",
        args: { id: "proposal id (optional)", section: "yesterday|top (optional)" },
        run: (args) => {
          scrollTo({
            id: typeof args.id === "string" ? args.id : undefined,
            section: typeof args.section === "string" ? args.section : undefined,
          });
        },
      },
      {
        name: "highlight",
        description: "Briefly flash a proposal so the user notices it.",
        args: { id: "proposal id" },
        run: (args) => {
          const id = String(args.id ?? "");
          if (!id) return;
          scrollTo({ id });
        },
      },
    ]);
  }, [approveProposal, scrollTo, setStatus]);

  const total = seed.briefProposals.length;
  const showing = filtered.length;
  const filtersActive = toneFilter !== "all" || integration !== null;

  return (
    <RoomStateOverlay room="brief" state={roomState}>
      <div ref={scrollRef} className="@container/brief mx-auto w-full max-w-[760px]">
        <header className="mb-6 @[640px]/brief:mb-10">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            morning brief · {new Date().toLocaleDateString(undefined, { weekday: "long" })}
          </p>
          <h1
            className="mt-2 font-medium leading-[1.05] tracking-tight text-ink-90"
            style={{ fontSize: "clamp(24px, 5.6cqw, 40px)" }}
          >
            {total} for you today.
          </h1>
          <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-ink-60 @[640px]/brief:text-[15px]">
            overnight proposals. approve to shadow deploy, promote after one clean cycle.
          </p>
        </header>

        <FilterBar
          tone={toneFilter}
          setTone={setToneFilter}
          integration={integration}
          setIntegration={setIntegration}
          showing={showing}
          total={total}
          active={filtersActive}
        />

        <div className="mt-6 space-y-4">
          {filtered.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              expanded={!!expanded[p.id]}
              status={statuses[p.id] ?? "pending"}
              flashing={highlight === p.id}
              setRef={(el) => (cardRefs.current[p.id] = el)}
              onToggleExpand={() =>
                setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))
              }
              onApprove={() => approveProposal(p.id)}
              onDefer={() => setStatus(p.id, "deferred")}
            />
          ))}
          {filtered.length === 0 && (
            <div className="rounded-lg border border-dashed border-rule px-6 py-10 text-center">
              <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
                nothing matches
              </p>
              <p className="mt-2 text-[14px] text-ink-60">
                try clearing filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setToneFilter("all");
                  setIntegration(null);
                }}
                className="mt-4 font-mono text-[11px] text-ink-90 underline-offset-4 hover:underline"
              >
                clear filters
              </button>
            </div>
          )}
        </div>

        <Hairline className="my-12" />

        <YesterdaySection ref={yesterdayRef} />

        <p className="mt-6 mb-2 font-mono text-[11px] text-ink-35 text-right">
          {seed.nodes.length} nodes · {seed.edges.length} edges in memory
        </p>
      </div>
    </RoomStateOverlay>
  );
}

function FilterBar({
  tone,
  setTone,
  integration,
  setIntegration,
  showing,
  total,
  active,
}: {
  tone: ToneFilter;
  setTone: (t: ToneFilter) => void;
  integration: string | null;
  setIntegration: (i: string | null) => void;
  showing: number;
  total: number;
  active: boolean;
}) {
  const TONES: ToneFilter[] = ["all", "high", "med", "low"];
  return (
    <div
      data-testid="brief-filterbar"
      className="sticky top-0 z-10 -mx-4 mb-1 border-b border-rule bg-paper-0 px-4 py-3"
    >
      <div className="flex flex-col gap-2 @[640px]/brief:flex-row @[640px]/brief:items-center @[640px]/brief:gap-x-4">
        <FilterRow label="tone">
          {TONES.map((t) => (
            <FilterPill
              key={t}
              active={tone === t}
              onClick={() => setTone(t)}
              title={TONE_TITLE[t]}
            >
              {TONE_LABEL[t]}
            </FilterPill>
          ))}
        </FilterRow>
        <FilterRow label="integration">
          <FilterPill
            active={integration === null}
            onClick={() => setIntegration(null)}
          >
            any
          </FilterPill>
          {ALL_INTEGRATIONS.map((i) => (
            <FilterPill
              key={i}
              active={integration === i}
              onClick={() => setIntegration(integration === i ? null : i)}
            >
              {i}
            </FilterPill>
          ))}
        </FilterRow>
        <span className="ml-auto whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-35">
          {active ? `${showing} / ${total}` : `${total} proposals`}
        </span>
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-[5.5rem] shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-35 @[640px]/brief:w-auto">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      title={title}
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

function ProposalCard({
  proposal,
  expanded,
  status,
  flashing,
  setRef,
  onToggleExpand,
  onApprove,
  onDefer,
}: {
  proposal: (typeof seed.briefProposals)[number];
  expanded: boolean;
  status: "pending" | "approved" | "deferred";
  flashing: boolean;
  setRef: (el: HTMLElement | null) => void;
  onToggleExpand: () => void;
  onApprove: () => void;
  onDefer: () => void;
}) {
  const tone = confidenceTone(proposal.confidence);

  return (
    <article
      ref={setRef}
      id={`brief-${proposal.id}`}
      data-testid={`brief-card-${proposal.id}`}
      data-status={status}
      data-tone={tone}
      className={cn(
        "w-full rounded-lg border bg-paper-1",
        "px-5 py-5 @[640px]/brief:px-6",
        "transition-all duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        flashing
          ? "border-accent-indigo shadow-[0_0_0_2px_var(--color-accent-indigo-soft)]"
          : "border-rule",
        status === "approved" && "opacity-60",
        status === "deferred" && "opacity-40",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip tone={tone}>
          {tone} · {proposal.confidence.toFixed(2)}
        </Chip>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
          {proposal.id}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {proposal.integrations.map((i) => (
            <Chip key={i} tone="neutral">{i}</Chip>
          ))}
        </div>
      </div>

      <h3
        className="font-medium leading-snug tracking-tight text-ink-90"
        style={{ fontSize: "clamp(16px, 2.4vw, 20px)" }}
      >
        {proposal.title}
      </h3>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-60 @[640px]/brief:text-[15px]">
        {proposal.why}
      </p>

      {expanded && (
        <div className="mt-4">
          <Hairline className="mb-3" />
          <ol className="space-y-2">
            {proposal.recipe.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-[11px] text-ink-35 tabular-nums shrink-0 pt-1">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[14px] leading-relaxed text-ink-90">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button onClick={onApprove} disabled={status !== "pending"}>
          {status === "approved" ? "approved" : "approve"}
        </Button>
        <Button variant="ghost" onClick={onToggleExpand}>
          {expanded ? "hide" : "show me how"}
        </Button>
        <Button variant="text" onClick={onDefer} disabled={status !== "pending"}>
          not yet
        </Button>
      </div>
    </article>
  );
}

const YesterdaySection = forwardRef<HTMLElement>(function YesterdaySection(
  _props,
  ref,
) {
  const totalTriggers = seed.yesterdayRuns.reduce((a, r) => a + r.triggers, 0);
  const totalErrors = seed.yesterdayRuns.reduce((a, r) => a + r.errors, 0);
  return (
    <section ref={ref} data-testid="brief-yesterday">
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-wider text-ink-35">
        yesterday · {seed.yesterdayRuns.length} ran · {totalTriggers} triggers ·{" "}
        {totalErrors} errors
      </h2>
      <ul className="space-y-2">
        {seed.yesterdayRuns.map((r) => (
          <li
            key={r.slug}
            className="flex items-center gap-3 text-[13px] @[640px]/brief:text-[14px] text-ink-60"
          >
            <span
              aria-label={`health ${r.health}`}
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                r.health === "ok"
                  ? "bg-confidence-high"
                  : r.health === "warn"
                    ? "bg-confidence-med"
                    : "bg-confidence-low",
              )}
            />
            <span className="truncate font-mono text-ink-90">{r.slug}</span>
            <span className="ml-auto font-mono text-[11px] text-ink-35 tabular-nums">
              {r.triggers} triggers
              {r.errors > 0 ? ` · ${r.errors} errors` : ""}
              {r.skipped ? ` · ${r.skipped} skipped` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
});
