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
import { Chip } from "@/components/primitives/Chip";
import { Button } from "@/components/primitives/Button";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import { cn } from "@/lib/cn";

const ALL_WORKFLOW_INTEGRATIONS = Array.from(
  new Set(seed.workflows.flatMap((w) => w.integrations)),
).sort();

export function WorkflowRoom({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const roomState = useAgentStore((s) => s.roomStates.workflow);
  const slugFromPayload =
    typeof payload?.id === "string"
      ? payload.id
      : typeof payload?.slug === "string"
        ? payload.slug
        : null;

  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    slugFromPayload,
  );
  const [integration, setIntegration] = useState<string | null>(null);
  const [dag, setDag] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const filtered = useMemo(() => {
    return seed.workflows.filter((w) => {
      if (integration && !w.integrations.includes(integration)) return false;
      return true;
    });
  }, [integration]);

  const scrollToSlug = useCallback((slug: string) => {
    const el = itemRefs.current[slug];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(slug);
    window.setTimeout(() => setHighlight(null), 1400);
  }, []);

  /* ---- agent tools ---- */

  useEffect(() => {
    return registerTools("workflow", [
      {
        name: "filter",
        description: "Filter workflows by integration slug. Pass null to clear.",
        args: { integration: "slack|github|linear|... or null" },
        run: (args) => {
          if ("integration" in args) {
            const v = args.integration;
            setIntegration(typeof v === "string" && v.length > 0 ? v : null);
          }
        },
      },
      {
        name: "clear_filters",
        description: "Reset filters.",
        run: () => setIntegration(null),
      },
      {
        name: "select",
        description: "Open the workflow detail view by slug.",
        args: { slug: "workflow slug" },
        run: (args) => {
          const slug = String(args.slug ?? "");
          if (slug) setSelectedSlug(slug);
        },
      },
      {
        name: "back",
        description: "Return to the workflow list.",
        run: () => setSelectedSlug(null),
      },
      {
        name: "show_dag",
        description: "Show the DAG visualization in detail view.",
        run: () => setDag(true),
      },
      {
        name: "show_recipe",
        description: "Show the plain-english recipe in detail view.",
        run: () => setDag(false),
      },
      {
        name: "toggle_view",
        description: "Toggle between recipe and DAG views.",
        run: () => setDag((d) => !d),
      },
      {
        name: "scroll_to",
        description:
          "Scroll the list to a workflow slug (highlights it briefly). In detail view this is a no-op.",
        args: { slug: "workflow slug" },
        run: (args) => {
          const slug = String(args.slug ?? "");
          if (slug) scrollToSlug(slug);
        },
      },
      {
        name: "highlight",
        description: "Briefly flash a workflow row to direct attention.",
        args: { slug: "workflow slug" },
        run: (args) => {
          const slug = String(args.slug ?? "");
          if (!slug) return;
          if (selectedSlug) setSelectedSlug(null);
          window.setTimeout(() => scrollToSlug(slug), 30);
        },
      },
    ]);
  }, [scrollToSlug, selectedSlug]);

  if (selectedSlug) {
    const selected = seed.workflows.find((w) => w.slug === selectedSlug);
    if (selected) {
      return (
        <RoomStateOverlay room="workflow" state={roomState}>
          <WorkflowDetail
            workflow={selected}
            dag={dag}
            setDag={setDag}
            onBack={() => setSelectedSlug(null)}
          />
        </RoomStateOverlay>
      );
    }
  }

  return (
    <RoomStateOverlay room="workflow" state={roomState}>
      <div ref={scrollRef} className="@container/workflow mx-auto w-full max-w-[820px]">
        <header className="mb-6 @[640px]/workflow:mb-10">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            workflows · {seed.workflows.length} live
          </p>
          <h1
            className="mt-2 font-medium leading-[1.05] tracking-tight text-ink-90"
            style={{ fontSize: "clamp(24px, 5.6cqw, 40px)" }}
          >
            workflows.
          </h1>
        </header>

        <FilterBar
          integration={integration}
          setIntegration={setIntegration}
          showing={filtered.length}
          total={seed.workflows.length}
        />

        <ul className="mt-2 divide-y divide-rule border-b border-rule">
          {filtered.map((w) => (
            <li
              key={w.slug}
              ref={(el) => {
                itemRefs.current[w.slug] = el;
              }}
              data-testid={`workflow-row-${w.slug}`}
              className={cn(
                "relative transition-colors duration-200",
                highlight === w.slug && "bg-accent-indigo-soft",
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedSlug(w.slug)}
                className="group flex w-full flex-col gap-3 py-5 text-left transition-colors hover:bg-paper-1 @[640px]/workflow:flex-row @[640px]/workflow:items-start @[640px]/workflow:gap-6 px-2 -mx-2 rounded-md"
              >
                <div className="min-w-0 flex-1">
                  <h2
                    className="font-medium tracking-tight text-ink-90"
                    style={{ fontSize: "clamp(16px, 2.4cqw, 20px)" }}
                  >
                    {w.title}
                  </h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-60 @[640px]/workflow:text-[14px]">
                    <span className="text-ink-35">when</span> {w.trigger}{" "}
                    <span className="text-ink-35">→</span> {w.outcome}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 @[640px]/workflow:shrink-0">
                  <Chip tone="neutral">{w.runsLast7d} / 7d</Chip>
                  {w.integrations.map((i) => (
                    <Chip key={i} tone="neutral">
                      {i}
                    </Chip>
                  ))}
                </div>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="py-10 text-center">
              <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
                no workflows match
              </p>
              <button
                type="button"
                onClick={() => setIntegration(null)}
                className="mt-3 font-mono text-[11px] text-ink-90 underline-offset-4 hover:underline"
              >
                clear filter
              </button>
            </li>
          )}
        </ul>

        <p className="mt-6 mb-2 font-mono text-[11px] text-ink-35">
          say &ldquo;show me the bug triage one&rdquo; to open it.
        </p>
      </div>
    </RoomStateOverlay>
  );
}

function FilterBar({
  integration,
  setIntegration,
  showing,
  total,
}: {
  integration: string | null;
  setIntegration: (i: string | null) => void;
  showing: number;
  total: number;
}) {
  const active = integration !== null;
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-1 border-b border-rule bg-paper-0 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-[5.5rem] shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-35 @[640px]/workflow:w-auto">
          integration
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Pill
            active={!active}
            onClick={() => setIntegration(null)}
          >
            any
          </Pill>
          {ALL_WORKFLOW_INTEGRATIONS.map((i) => (
            <Pill
              key={i}
              active={integration === i}
              onClick={() => setIntegration(integration === i ? null : i)}
            >
              {i}
            </Pill>
          ))}
        </div>
        <span className="ml-auto whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-35">
          {active ? `${showing} / ${total}` : `${total}`}
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

function WorkflowDetail({
  workflow,
  dag,
  setDag,
  onBack,
}: {
  workflow: (typeof seed.workflows)[number];
  dag: boolean;
  setDag: (v: boolean) => void;
  onBack: () => void;
}) {
  return (
    <div className="@container/workflow mx-auto w-full max-w-[820px]">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-35 hover:text-ink-90 transition-colors"
      >
        <span aria-hidden>←</span> all workflows
      </button>

      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          workflow · {workflow.slug}
        </p>
        <h1
          className="mt-2 font-medium leading-[1.05] tracking-tight text-ink-90"
          style={{ fontSize: "clamp(22px, 4.6cqw, 32px)" }}
        >
          {workflow.title}
        </h1>
        <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-ink-60 @[640px]/workflow:text-[15px]">
          <span className="text-ink-35">when</span> {workflow.trigger}{" "}
          <span className="text-ink-35">→</span> {workflow.outcome}
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          {dag ? "dag · nodes + edges" : "recipe · plain english"}
        </h2>
        <div className="flex items-center gap-1">
          <SegBtn active={!dag} onClick={() => setDag(false)}>
            recipe
          </SegBtn>
          <SegBtn active={dag} onClick={() => setDag(true)}>
            dag
          </SegBtn>
        </div>
      </div>

      {!dag ? (
        <ol className="space-y-3">
          {workflow.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-4">
              <span className="mt-0.5 inline-block w-7 shrink-0 font-mono text-[11px] tabular-nums text-ink-35">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="flex-1 leading-relaxed text-ink-90"
                style={{ fontSize: "clamp(14px, 1.9cqw, 16px)" }}
              >
                {step}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="muji-scroll overflow-x-auto pb-3">
          <div className="flex w-max items-center gap-2 font-mono text-[11px]">
            {workflow.steps.map((step, i) => (
              <div key={i} className="flex items-center">
                <div
                  className={cn(
                    "max-w-[200px] min-w-[140px] rounded border border-rule bg-paper-1 px-3 py-2 text-ink-60",
                    "transition-colors hover:border-rule-strong",
                  )}
                >
                  <span className="mr-1 text-ink-35">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-ink-90">
                    {step.split(/[.,;:]/)[0]?.trim()}
                  </span>
                </div>
                {i < workflow.steps.length - 1 && (
                  <span className="px-1 text-ink-35">→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Hairline className="mt-10 mb-4" />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-ink-35">
        <span>confidence · {workflow.confidence.toFixed(2)}</span>
        <span>last run · {workflow.lastRun}</span>
        <span>{workflow.runsLast7d} runs / 7d</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {workflow.integrations.map((i) => (
            <Chip key={i} tone="neutral">{i}</Chip>
          ))}
        </span>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button>run now</Button>
        <Button variant="ghost">edit</Button>
        <Button variant="text">disable</Button>
      </div>
    </div>
  );
}

function SegBtn({
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
      className={cn(
        "rounded-sm px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider",
        "transition-colors duration-150",
        active
          ? "bg-ink-90 text-paper-0"
          : "text-ink-60 hover:text-ink-90",
      )}
    >
      {children}
    </button>
  );
}
