"use client";

import { useState } from "react";
import { seed } from "@/lib/seed/ontology";
import { Chip } from "@/components/primitives/Chip";
import { Button } from "@/components/primitives/Button";
import { Hairline } from "@/components/primitives/Hairline";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

function ConfidenceTone(c: number): "high" | "med" | "low" {
  if (c >= 0.9) return "high";
  if (c >= 0.7) return "med";
  return "low";
}

export function BriefRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.brief);
  const pushCard = useAgentStore((s) => s.pushCard);

  return (
    <RoomStateOverlay room="brief" state={roomState}>
      <section>
        <header className="mb-12">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            morning brief · {new Date().toLocaleDateString(undefined, { weekday: "long" })}
          </p>
          <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
            {seed.briefProposals.length} for you today.
          </h1>
          <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-60">
            I read last night. Here is what I would take off your plate today.
            Approve them and I will run each in shadow mode first, then promote
            to live after one clean cycle.
          </p>
        </header>

        <div className="space-y-6">
          {seed.briefProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onApprove={() => {
              pushCard({
                id: `toast-approve-${p.id}`,
                kind: "toast",
                data: { text: `Queued "${p.title.slice(0, 40)}..." for shadow deploy.` },
                ttl: 4000,
              });
            }} />
          ))}
        </div>

        <Hairline className="my-12" />

        <section>
          <h2 className="mb-4 font-mono text-[11px] uppercase tracking-wider text-ink-35">
            yesterday · {seed.yesterdayRuns.length} ran ·{" "}
            {seed.yesterdayRuns.reduce((a, r) => a + r.triggers, 0)} triggers ·{" "}
            {seed.yesterdayRuns.reduce((a, r) => a + r.errors, 0)} errors
          </h2>
          <ul className="space-y-2 text-[14px] text-ink-60">
            {seed.yesterdayRuns.map((r) => (
              <li key={r.slug} className="flex items-center gap-3">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    r.health === "ok"
                      ? "bg-confidence-high"
                      : r.health === "warn"
                        ? "bg-confidence-med"
                        : "bg-confidence-low",
                  )}
                />
                <span>
                  {r.slug} · {r.triggers} triggers
                  {r.errors > 0 ? ` · ${r.errors} errors` : " · no errors"}
                  {r.skipped ? ` · ${r.skipped} skipped` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-8 text-right font-mono text-[11px] text-ink-35">
          {seed.nodes.length} nodes · {seed.edges.length} edges in memory
        </p>
      </section>
    </RoomStateOverlay>
  );
}

function ProposalCard({
  proposal,
  onApprove,
}: {
  proposal: (typeof seed.briefProposals)[number];
  onApprove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<"pending" | "approved" | "deferred">("pending");
  const tone = ConfidenceTone(proposal.confidence);

  return (
    <article
      data-testid={`brief-card-${proposal.id}`}
      className={cn(
        "w-full border border-rule bg-paper-1 px-6 py-5 rounded-lg",
        "transition-all duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        state === "approved" && "opacity-60",
        state === "deferred" && "opacity-40",
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <Chip tone={tone}>
          {tone} · {proposal.confidence.toFixed(2)}
        </Chip>
        <div className="flex gap-1.5">
          {proposal.integrations.map((i) => (
            <Chip key={i} tone="neutral">{i}</Chip>
          ))}
        </div>
      </div>

      <h3 className="text-[20px] font-medium leading-snug tracking-tight text-ink-90">
        {proposal.title}
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-60">
        {proposal.why}
      </p>

      {expanded && (
        <div className="mt-4">
          <Hairline className="mb-3" />
          <ol className="space-y-2 font-mono text-[12px] text-ink-60">
            {proposal.recipe.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-ink-35">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-sans text-[14px] text-ink-90">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button
          onClick={() => {
            setState("approved");
            onApprove();
          }}
          disabled={state !== "pending"}
        >
          {state === "approved" ? "approved" : "approve"}
        </Button>
        <Button variant="ghost" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "hide" : "show me how"}
        </Button>
        <Button
          variant="text"
          onClick={() => setState("deferred")}
          disabled={state !== "pending"}
        >
          not yet
        </Button>
      </div>
    </article>
  );
}
