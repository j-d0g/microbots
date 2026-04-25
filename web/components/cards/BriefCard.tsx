"use client";

import { useState } from "react";
import { Chip } from "@/components/primitives/Chip";
import { Button } from "@/components/primitives/Button";
import { Hairline } from "@/components/primitives/Hairline";
import { cn } from "@/lib/cn";

export interface BriefProposal {
  id: string;
  title: string;
  why: string;
  integrations: string[];
  confidence: number;
  recipe: string[];
}

export function BriefCard({ proposal }: { proposal: BriefProposal }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<"pending" | "approved" | "deferred">(
    "pending",
  );

  const tone: "high" | "med" | "low" =
    proposal.confidence >= 0.9
      ? "high"
      : proposal.confidence >= 0.7
        ? "med"
        : "low";

  return (
    <article
      className={cn(
        "w-full border border-rule bg-paper-1 px-6 py-5",
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
            <Chip key={i} tone="neutral">
              {i}
            </Chip>
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
          onClick={() => setState("approved")}
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
