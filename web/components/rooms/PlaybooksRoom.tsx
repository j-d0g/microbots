"use client";

import { seed } from "@/lib/seed/ontology";
import { Chip } from "@/components/primitives/Chip";
import { Hairline } from "@/components/primitives/Hairline";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import type { PlaybookDef } from "@/lib/seed/types";

function Column({
  title,
  items,
  tone,
}: {
  title: string;
  items: PlaybookDef[];
  tone: "neutral" | "accent";
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          {title}
        </h2>
        <Chip tone={tone}>{items.length}</Chip>
      </div>
      <ul className="space-y-4">
        {items.map((p) => (
          <li
            key={p.title}
            className="rounded-lg border border-rule bg-paper-1 px-4 py-4"
          >
            <h3 className="text-[15px] font-medium text-ink-90">{p.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-60">
              {p.oneLiner}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.integrations.map((i) => (
                <Chip key={i} tone="neutral">{i}</Chip>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                className="font-mono text-[11px] text-ink-60 underline-offset-4 hover:underline"
              >
                try tonight &rarr;
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

export function PlaybooksRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.playbooks);
  const total =
    seed.playbooks.org.length +
    seed.playbooks.network.length +
    seed.playbooks.suggested.length;

  return (
    <RoomStateOverlay room="playbooks" state={roomState}>
      <section>
        <header className="mb-10">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            playbooks · internet of intelligence · {total} available
          </p>
          <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
            playbooks.
          </h1>
          <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-60">
            your org, the network, and matched suggestions. nothing deploys without your approval.
          </p>
        </header>
        <Hairline className="mb-8" />
        <div className="grid grid-cols-3 gap-10" data-testid="playbooks-columns">
          <Column title="your org" items={seed.playbooks.org} tone="neutral" />
          <Column title="network" items={seed.playbooks.network} tone="neutral" />
          <Column title="suggested for you" items={seed.playbooks.suggested} tone="accent" />
        </div>
      </section>
    </RoomStateOverlay>
  );
}
