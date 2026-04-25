"use client";

import { seed } from "@/lib/seed/ontology";
import { Hairline } from "@/components/primitives/Hairline";
import { Chip } from "@/components/primitives/Chip";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-5 font-mono text-[11px] uppercase tracking-wider text-ink-35">
        {title}
      </h2>
      {children}
      <Hairline className="mt-10 mb-10" />
    </section>
  );
}

export function SettingsRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.settings);

  return (
    <RoomStateOverlay room="settings" state={roomState}>
      <div className="mx-auto max-w-[720px]">
        <header className="mb-12">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            settings
          </p>
          <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
            defaults.
          </h1>
        </header>

        <Section title="integrations">
          <ul className="divide-y divide-rule border-y border-rule">
            {seed.integrations.map((i) => (
              <li
                key={i.slug}
                className="flex items-center justify-between py-3"
              >
                <span className="font-mono text-[13px] text-ink-90">
                  {i.slug}
                </span>
                <Chip tone={i.status === "connected" ? "high" : "neutral"}>
                  {i.status}
                </Chip>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="members and roles">
          <ul className="divide-y divide-rule border-y border-rule">
            {seed.members.map((m) => (
              <li
                key={m.email}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <p className="text-[14px] text-ink-90">{m.name}</p>
                  <p className="font-mono text-[11px] text-ink-35">{m.email}</p>
                </div>
                <Chip tone={m.role === "owner" ? "accent" : "neutral"}>
                  {m.role}
                </Chip>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="org profile">
          <div className="space-y-2 text-[14px] text-ink-60">
            <p><span className="text-ink-90">{seed.persona.company}</span> -- {seed.persona.companyDescription}</p>
            <p>{seed.persona.teamSize} team members</p>
          </div>
        </Section>

        <Section title="overnight schedule">
          <p className="text-[14px] text-ink-60">
            proposer runs at 03:00 local. above threshold goes to morning brief.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <Chip tone="accent">threshold · {seed.confidenceThreshold.toFixed(2)}</Chip>
            <span className="font-mono text-[11px] text-ink-35">
              (edit via waffle -- &quot;raise my threshold to 0.9&quot;)
            </span>
          </div>
        </Section>

        <Section title="voice">
          <p className="text-[14px] text-ink-60">
            web speech API. browser-native. no external keys.
          </p>
        </Section>

        <Section title="memory">
          <div className="space-y-2 text-[14px] text-ink-60">
            <p>
              {seed.nodes.length} nodes, {seed.edges.length} edges in the ontology.
            </p>
            <p>
              export, scope-delete, retention. nothing leaves the device until you say so.
            </p>
          </div>
        </Section>

        <section>
          <h2 className="mb-5 font-mono text-[11px] uppercase tracking-wider text-confidence-low">
            danger zone
          </h2>
          <p className="text-[14px] text-ink-60">
            wipe the entire memory graph. cannot be undone.
          </p>
          <button
            type="button"
            className="mt-4 border border-confidence-low/40 px-4 py-2 font-mono text-[12px] text-confidence-low hover:bg-confidence-low/10 transition-colors"
          >
            wipe graph
          </button>
        </section>
      </div>
    </RoomStateOverlay>
  );
}
