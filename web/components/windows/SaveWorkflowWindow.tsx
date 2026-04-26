"use client";

/**
 * save_workflow window — name, code diff, destination URL.
 *
 * Confirm-gated: stages a ui.confirm before executing.
 * Shows deployed URL after confirmation.
 */

import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function SaveWorkflowWindow({ payload }: { payload?: Record<string, unknown> }) {
  const name = (payload?.name as string) ?? "untitled";
  const code = (payload?.code as string) ?? "";
  const url = (payload?.url as string) ?? null;
  const savedTo = (payload?.saved_to as string) ?? null;
  const bytes = (payload?.bytes as number) ?? 0;
  const status = (payload?.status as string) ?? "pending";
  const error = (payload?.error as string | null) ?? null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto muji-scroll p-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35 mb-2">
          save_workflow
        </p>

        {/* Name */}
        <div className="mb-3">
          <p className="font-mono text-[10px] text-ink-35 mb-1">name</p>
          <p className="font-mono text-[13px] text-ink-90">{name}</p>
        </div>

        {/* Code preview */}
        <div className="mb-3">
          <p className="font-mono text-[10px] text-ink-35 mb-1">code</p>
          <pre className="font-mono text-[11px] text-ink-60 whitespace-pre-wrap bg-paper-2/50 rounded p-2 max-h-[200px] overflow-auto muji-scroll">
            {code || "// no code provided"}
          </pre>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 p-2 rounded bg-confidence-low/10 border border-confidence-low/20">
            <p className="font-mono text-[11px] text-confidence-low">{error}</p>
          </div>
        )}

        {/* Success */}
        {url && (
          <div className="mb-3 p-2 rounded bg-confidence-high/10 border border-confidence-high/20">
            <p className="font-mono text-[10px] text-ink-35 mb-1">deployed to</p>
            <p className="font-mono text-[11px] text-accent-indigo break-all">{url}</p>
            {savedTo && (
              <p className="font-mono text-[10px] text-ink-35 mt-1">{savedTo} ({bytes} bytes)</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-rule/50 px-3 py-2 flex items-center justify-between">
        <span className={cn(
          "font-mono text-[10px] uppercase tracking-wider",
          status === "done" ? "text-confidence-high"
            : error ? "text-confidence-low"
            : "text-ink-35",
        )}>
          {status}
        </span>
        <span className="font-mono text-[10px] text-ink-35">
          try: &quot;run it&quot;
        </span>
      </div>
    </div>
  );
}
