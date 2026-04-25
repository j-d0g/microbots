"use client";

import { useState } from "react";
import { seed } from "@/lib/seed/ontology";
import { Hairline } from "@/components/primitives/Hairline";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

const HEALTH_TONE: Record<string, string> = {
  ok: "bg-confidence-high",
  warn: "bg-confidence-med",
  down: "bg-confidence-low",
};

export function StackRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.stack);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selected = selectedSlug
    ? seed.services.find((s) => s.slug === selectedSlug)
    : null;

  const columns: Record<number, (typeof seed.services)> = {};
  for (const s of seed.services) {
    (columns[s.column] ??= []).push(s);
  }

  return (
    <RoomStateOverlay room="stack" state={roomState}>
      <section>
        <header className="mb-10">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            microservices · {seed.services.length} deployed
          </p>
          <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
            Your stack, block by block.
          </h1>
          <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-60">
            Each block is a small Python service. Workflows own a column;
            blocks stack. Click a block to see logs.
          </p>
        </header>

        <Hairline className="mb-6" />

        <div className="grid grid-cols-3 gap-6">
          {Object.entries(columns).map(([col, list]) => (
            <div key={col} className="flex flex-col gap-2">
              {list.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => setSelectedSlug(
                    selectedSlug === s.slug ? null : s.slug,
                  )}
                  data-testid={`service-block-${s.slug}`}
                  className={cn(
                    "relative w-full border border-rule bg-paper-1 px-4 py-3 text-left rounded-lg",
                    "transition-colors hover:bg-paper-2",
                    selectedSlug === s.slug && "border-accent-indigo",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-mono text-[13px] text-ink-90">
                      {s.slug}
                      <span className="ml-2 text-ink-35">@{s.version}</span>
                    </h3>
                    <span
                      aria-label={`health ${s.health}`}
                      className={cn(
                        "mt-1 h-1.5 w-1.5 rounded-full",
                        HEALTH_TONE[s.health],
                      )}
                    />
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-60">
                    {s.purpose}
                  </p>
                  <p className="mt-3 font-mono text-[10px] text-ink-35">
                    {s.runtime} · {s.deployedAt}
                    {s.schedule ? ` · ${s.schedule}` : ""}
                  </p>
                </button>
              ))}
            </div>
          ))}
        </div>

        {selected && (
          <div className="mt-6" data-testid="service-drawer">
            <Hairline className="mb-4" />
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
                logs · {selected.slug}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedSlug(null)}
                className="font-mono text-[11px] text-ink-35 hover:text-ink-60"
              >
                close
              </button>
            </div>
            <div className="rounded border border-rule bg-ink-90 p-4 overflow-x-auto max-h-[300px] overflow-y-auto">
              <pre className="font-mono text-[11px] leading-relaxed text-paper-1 whitespace-pre">
                {selected.logs.join("\n")}
              </pre>
            </div>
            <div className="mt-3 flex gap-4 font-mono text-[10px] text-ink-35">
              <span>schedule: {selected.schedule || "none"}</span>
              <span>runtime: {selected.runtime}</span>
              <span>deployed: {selected.deployedAt}</span>
            </div>
          </div>
        )}
      </section>
    </RoomStateOverlay>
  );
}
