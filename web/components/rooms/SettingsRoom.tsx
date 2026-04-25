"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { seed } from "@/lib/seed/ontology";
import { Hairline } from "@/components/primitives/Hairline";
import { Chip } from "@/components/primitives/Chip";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import { cn } from "@/lib/cn";

type SectionKey =
  | "integrations"
  | "members"
  | "org"
  | "schedule"
  | "voice"
  | "memory"
  | "danger";

const SECTION_LABEL: Record<SectionKey, string> = {
  integrations: "integrations",
  members: "members and roles",
  org: "org profile",
  schedule: "overnight schedule",
  voice: "voice",
  memory: "memory",
  danger: "danger zone",
};

const SECTION_ALIASES: Record<string, SectionKey> = {
  integrations: "integrations",
  integration: "integrations",
  members: "members",
  team: "members",
  roles: "members",
  org: "org",
  organisation: "org",
  organization: "org",
  schedule: "schedule",
  cron: "schedule",
  threshold: "schedule",
  voice: "voice",
  memory: "memory",
  graph: "memory",
  danger: "danger",
  wipe: "danger",
};

export function SettingsRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.settings);
  const pushCard = useAgentStore((s) => s.pushCard);

  const [integrationFilter, setIntegrationFilter] = useState<
    "all" | "connected" | "disconnected"
  >("all");
  const [highlight, setHighlight] = useState<SectionKey | null>(null);

  const sectionRefs = useRef<Record<SectionKey, HTMLElement | null>>({
    integrations: null,
    members: null,
    org: null,
    schedule: null,
    voice: null,
    memory: null,
    danger: null,
  });

  const filteredIntegrations = useMemo(() => {
    if (integrationFilter === "all") return seed.integrations;
    return seed.integrations.filter((i) => i.status === integrationFilter);
  }, [integrationFilter]);

  const scrollToSection = useCallback((section: SectionKey) => {
    const el = sectionRefs.current[section];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlight(section);
    window.setTimeout(() => setHighlight(null), 1500);
  }, []);

  /* ---- agent tools ---- */

  useEffect(() => {
    return registerTools("settings", [
      {
        name: "scroll_to",
        description:
          "Scroll to a settings section: integrations|members|org|schedule|voice|memory|danger.",
        args: { section: "section name" },
        run: (args) => {
          const raw = String(args.section ?? "").toLowerCase();
          const mapped = SECTION_ALIASES[raw] ?? (raw as SectionKey);
          if (mapped in sectionRefs.current) scrollToSection(mapped);
        },
      },
      {
        name: "highlight",
        description: "Briefly flash a settings section.",
        args: { section: "section name" },
        run: (args) => {
          const raw = String(args.section ?? "").toLowerCase();
          const mapped = SECTION_ALIASES[raw] ?? (raw as SectionKey);
          if (mapped in sectionRefs.current) scrollToSection(mapped);
        },
      },
      {
        name: "filter",
        description:
          "Filter integrations list by status (all|connected|disconnected).",
        args: { integrations: "all|connected|disconnected" },
        run: (args) => {
          const v = args.integrations as
            | "all"
            | "connected"
            | "disconnected"
            | undefined;
          if (v === "all" || v === "connected" || v === "disconnected") {
            setIntegrationFilter(v);
          }
        },
      },
      {
        name: "clear_filters",
        description: "Reset filters.",
        run: () => setIntegrationFilter("all"),
      },
      {
        name: "wipe_graph",
        description: "Stage memory wipe (drops a destructive toast). No real wipe yet.",
        run: () => {
          pushCard({
            id: `toast-wipe-${Date.now()}`,
            kind: "toast",
            data: { text: "wipe_graph requires explicit voice confirmation." },
            ttl: 5000,
          });
        },
      },
    ]);
  }, [pushCard, scrollToSection]);

  return (
    <RoomStateOverlay room="settings" state={roomState}>
      <div className="@container/settings mx-auto w-full max-w-[760px]">
        <header className="mb-8 @[640px]/settings:mb-12">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            settings
          </p>
          <h1
            className="mt-2 font-medium leading-[1.05] tracking-tight text-ink-90"
            style={{ fontSize: "clamp(24px, 5.6cqw, 40px)" }}
          >
            defaults.
          </h1>
        </header>

        <SectionNav
          onJump={scrollToSection}
          integrationFilter={integrationFilter}
          setIntegrationFilter={setIntegrationFilter}
        />

        <Section
          ref={(el) => { sectionRefs.current.integrations = el; }}
          title={SECTION_LABEL.integrations}
          flashing={highlight === "integrations"}
          aside={
            <span className="font-mono text-[11px] tabular-nums text-ink-35">
              {filteredIntegrations.length} / {seed.integrations.length}
            </span>
          }
        >
          <ul className="divide-y divide-rule border-y border-rule">
            {filteredIntegrations.map((i) => (
              <li
                key={i.slug}
                className="flex items-center justify-between gap-4 py-3"
              >
                <span className="font-mono text-[13px] text-ink-90">
                  {i.slug}
                </span>
                <Chip tone={i.status === "connected" ? "high" : "neutral"}>
                  {i.status}
                </Chip>
              </li>
            ))}
            {filteredIntegrations.length === 0 && (
              <li className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-ink-35">
                none
              </li>
            )}
          </ul>
        </Section>

        <Section
          ref={(el) => { sectionRefs.current.members = el; }}
          title={SECTION_LABEL.members}
          flashing={highlight === "members"}
        >
          <ul className="divide-y divide-rule border-y border-rule">
            {seed.members.map((m) => (
              <li
                key={m.email}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-ink-90">{m.name}</p>
                  <p className="truncate font-mono text-[11px] text-ink-35">
                    {m.email}
                  </p>
                </div>
                <Chip tone={m.role === "owner" ? "accent" : "neutral"}>
                  {m.role}
                </Chip>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          ref={(el) => { sectionRefs.current.org = el; }}
          title={SECTION_LABEL.org}
          flashing={highlight === "org"}
        >
          <div className="space-y-2 text-[14px] text-ink-60">
            <p>
              <span className="text-ink-90">{seed.persona.company}</span>{" "}
              <span className="text-ink-35">·</span>{" "}
              {seed.persona.companyDescription}
            </p>
            <p>{seed.persona.teamSize} team members</p>
          </div>
        </Section>

        <Section
          ref={(el) => { sectionRefs.current.schedule = el; }}
          title={SECTION_LABEL.schedule}
          flashing={highlight === "schedule"}
        >
          <p className="text-[14px] leading-relaxed text-ink-60">
            proposer runs at 03:00 local. above threshold goes to morning brief.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Chip tone="accent">
              threshold · {seed.confidenceThreshold.toFixed(2)}
            </Chip>
            <span className="font-mono text-[11px] text-ink-35">
              say &ldquo;raise my threshold to 0.9&rdquo;
            </span>
          </div>
        </Section>

        <Section
          ref={(el) => { sectionRefs.current.voice = el; }}
          title={SECTION_LABEL.voice}
          flashing={highlight === "voice"}
        >
          <p className="text-[14px] leading-relaxed text-ink-60">
            web speech api · browser-native · no external keys.
          </p>
        </Section>

        <Section
          ref={(el) => { sectionRefs.current.memory = el; }}
          title={SECTION_LABEL.memory}
          flashing={highlight === "memory"}
        >
          <div className="space-y-2 text-[14px] leading-relaxed text-ink-60">
            <p>
              {seed.nodes.length} nodes · {seed.edges.length} edges in the
              ontology.
            </p>
            <p>
              export, scope-delete, retention. nothing leaves the device until
              you say so.
            </p>
          </div>
        </Section>

        <DangerSection
          ref={(el) => { sectionRefs.current.danger = el; }}
          flashing={highlight === "danger"}
        />
      </div>
    </RoomStateOverlay>
  );
}

function SectionNav({
  onJump,
  integrationFilter,
  setIntegrationFilter,
}: {
  onJump: (s: SectionKey) => void;
  integrationFilter: "all" | "connected" | "disconnected";
  setIntegrationFilter: (v: "all" | "connected" | "disconnected") => void;
}) {
  const SECTIONS: SectionKey[] = [
    "integrations",
    "members",
    "org",
    "schedule",
    "voice",
    "memory",
    "danger",
  ];
  const FILTERS: Array<"all" | "connected" | "disconnected"> = [
    "all",
    "connected",
    "disconnected",
  ];
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-rule bg-paper-0 px-4 py-3">
      <div className="flex flex-col gap-2 @[640px]/settings:flex-row @[640px]/settings:items-center @[640px]/settings:gap-x-4">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="w-[5.5rem] shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-35 @[640px]/settings:w-auto">
            jump to
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onJump(s)}
                className={cn(
                  "rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider",
                  "transition-colors duration-150",
                  s === "danger"
                    ? "border-confidence-low/40 text-confidence-low hover:bg-confidence-low/10"
                    : "border-rule text-ink-60 hover:border-ink-90 hover:text-ink-90",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="w-[5.5rem] shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-35 @[640px]/settings:w-auto">
            integrations
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setIntegrationFilter(f)}
                data-active={integrationFilter === f}
                className={cn(
                  "rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider",
                  "transition-colors duration-150",
                  integrationFilter === f
                    ? "border-ink-90 bg-ink-90 text-paper-0"
                    : "border-rule text-ink-60 hover:bg-paper-1",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  flashing?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}

const Section = forwardRef<HTMLElement, SectionProps>(function Section(
  { title, flashing, aside, children },
  ref,
) {
  return (
    <section
      ref={ref}
      data-testid={`settings-section-${title.replace(/\s+/g, "-")}`}
      className={cn(
        "scroll-mt-24 rounded-md transition-colors duration-300",
        flashing && "bg-accent-indigo-soft/60 ring-1 ring-accent-indigo/30 px-3 py-2 -mx-3",
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          {title}
        </h2>
        {aside}
      </div>
      {children}
      <Hairline className="my-10" />
    </section>
  );
});

const DangerSection = forwardRef<HTMLElement, { flashing?: boolean }>(
  function DangerSection({ flashing }, ref) {
    return (
      <section
        ref={ref}
        data-testid="settings-section-danger-zone"
        className={cn(
          "scroll-mt-24 rounded-md transition-colors duration-300",
          flashing &&
            "bg-confidence-low/10 ring-1 ring-confidence-low/30 px-3 py-2 -mx-3",
        )}
      >
        <h2 className="mb-4 font-mono text-[11px] uppercase tracking-wider text-confidence-low">
          danger zone
        </h2>
        <p className="text-[14px] leading-relaxed text-ink-60">
          wipe the entire memory graph. this cannot be undone.
        </p>
        <button
          type="button"
          className={cn(
            "mt-4 inline-flex items-center rounded-sm border px-3 py-1.5",
            "font-mono text-[11px] uppercase tracking-wider",
            "border-confidence-low/40 text-confidence-low",
            "transition-colors duration-150 hover:bg-confidence-low/10",
          )}
        >
          wipe graph
        </button>
      </section>
    );
  },
);
