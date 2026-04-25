"use client";

import { useState } from "react";
import { seed } from "@/lib/seed/ontology";
import { Hairline } from "@/components/primitives/Hairline";
import { Chip } from "@/components/primitives/Chip";
import { Button } from "@/components/primitives/Button";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";

export function WorkflowRoom({ payload }: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.workflow);
  const slugFromPayload = typeof payload?.id === "string" ? payload.id : null;
  const [selectedSlug, setSelectedSlug] = useState<string | null>(slugFromPayload);

  const selected = selectedSlug
    ? seed.workflows.find((w) => w.slug === selectedSlug)
    : null;

  if (selected) {
    return (
      <RoomStateOverlay room="workflow" state={roomState}>
        <WorkflowDetail workflow={selected} onBack={() => setSelectedSlug(null)} />
      </RoomStateOverlay>
    );
  }

  return (
    <RoomStateOverlay room="workflow" state={roomState}>
      <section>
        <header className="mb-10">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            workflows · {seed.workflows.length} live
          </p>
          <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
            Your automations, in plain English.
          </h1>
        </header>

        <ul className="divide-y divide-rule border-y border-rule">
          {seed.workflows.map((w) => (
            <li key={w.slug}>
              <button
                type="button"
                onClick={() => setSelectedSlug(w.slug)}
                className="group flex w-full items-start justify-between gap-6 py-5 text-left transition-colors hover:bg-paper-1"
              >
                <div className="flex-1">
                  <h2 className="text-[20px] font-medium tracking-tight text-ink-90">
                    {w.title}
                  </h2>
                  <p className="mt-1 text-[14px] text-ink-60">
                    <span className="text-ink-35">when</span> {w.trigger}{" "}
                    <span className="text-ink-35">&rarr;</span> {w.outcome}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Chip tone="neutral">{w.runsLast7d} / 7d</Chip>
                  {w.integrations.map((i) => (
                    <Chip key={i} tone="neutral">{i}</Chip>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <Hairline className="mt-8" />
        <p className="mt-4 font-mono text-[11px] text-ink-35">
          say &quot;show me the bug triage one&quot; to open it.
        </p>
      </section>
    </RoomStateOverlay>
  );
}

function WorkflowDetail({
  workflow,
  onBack,
}: {
  workflow: (typeof seed.workflows)[number];
  onBack: () => void;
}) {
  const [dag, setDag] = useState(false);

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 font-mono text-[11px] text-ink-35 hover:text-ink-60"
      >
        &larr; all workflows
      </button>

      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          workflow · {workflow.slug}
        </p>
        <h1 className="mt-2 text-[32px] font-medium leading-[1.1] tracking-tight">
          {workflow.title}
        </h1>
        <p className="mt-2 text-[15px] text-ink-60">
          <span className="text-ink-35">when</span> {workflow.trigger}{" "}
          <span className="text-ink-35">&rarr;</span> {workflow.outcome}
        </p>
      </header>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          {dag ? "dag · nodes + edges" : "recipe · plain english"}
        </h2>
        <Button variant="ghost" onClick={() => setDag((d) => !d)}>
          {dag ? "show recipe" : "show dag"}
        </Button>
      </div>

      {!dag ? (
        <ol className="space-y-3">
          {workflow.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-4">
              <span className="mt-0.5 inline-block w-8 shrink-0 font-mono text-[12px] text-ink-35">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 text-[16px] leading-relaxed text-ink-90">
                {step}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex items-center gap-3 font-mono text-[11px]">
            {workflow.steps.map((step, i) => (
              <div key={i} className="flex items-center">
                <div className="max-w-[180px] rounded border border-rule bg-paper-1 px-3 py-2 text-ink-60">
                  <span className="mr-1 text-ink-35">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {step.split(/[.,;:]/)[0]?.trim()}
                </div>
                {i < workflow.steps.length - 1 && (
                  <span className="px-2 text-ink-35">&rarr;</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Hairline className="mt-8 mb-4" />

      <div className="flex flex-wrap gap-4 font-mono text-[11px] text-ink-35">
        <span>confidence · {workflow.confidence.toFixed(2)}</span>
        <span>last run · {workflow.lastRun}</span>
        <span>{workflow.runsLast7d} runs / 7d</span>
        {workflow.integrations.map((i) => (
          <Chip key={i} tone="neutral">{i}</Chip>
        ))}
      </div>
    </section>
  );
}
