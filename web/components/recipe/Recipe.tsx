"use client";

import { useState } from "react";
import { Button } from "@/components/primitives/Button";

export function Recipe({ steps }: { steps: string[] }) {
  const [dag, setDag] = useState(false);
  return (
    <div>
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
          {steps.map((step, i) => (
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
            {steps.map((step, i) => (
              <div key={i} className="flex items-center">
                <div className="max-w-[180px] border border-rule bg-paper-1 px-3 py-2 text-ink-60">
                  <span className="mr-1 text-ink-35">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {firstSentence(step)}
                </div>
                {i < steps.length - 1 && (
                  <span className="px-2 text-ink-35">→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function firstSentence(s: string): string {
  const m = s.match(/^[^.,;:]+/);
  return (m ? m[0] : s).trim();
}
