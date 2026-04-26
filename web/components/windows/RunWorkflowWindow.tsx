"use client";

/**
 * run_workflow window — input form + streaming result display.
 *
 * Confirm-gated. Shows workflow name, args, result, stdout/stderr.
 */

import { cn } from "@/lib/cn";

export function RunWorkflowWindow({ payload }: { payload?: Record<string, unknown> }) {
  const name = (payload?.name as string) ?? "?";
  const result = payload?.result ?? null;
  const stdout = (payload?.stdout as string) ?? "";
  const stderr = (payload?.stderr as string) ?? "";
  const error = (payload?.error as string | null) ?? null;
  const status = (payload?.status as string) ?? "pending";
  const args = (payload?.args as Record<string, unknown>) ?? {};

  if (error === "not found") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <p className="font-mono text-[11px] text-confidence-low mb-2">
          workflow &quot;{name}&quot; not found
        </p>
        <p className="font-mono text-[10px] text-ink-35">
          try: &quot;list workflows&quot;
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto muji-scroll p-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35 mb-1">
          run_workflow
        </p>
        <p className="font-mono text-[14px] text-ink-90 mb-3">{name}</p>

        {/* Args */}
        {Object.keys(args).length > 0 && (
          <div className="mb-3">
            <p className="font-mono text-[10px] text-ink-35 mb-1">args</p>
            <pre className="font-mono text-[11px] text-ink-60 bg-paper-2/50 rounded p-2">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
        )}

        {/* Output */}
        {stdout && (
          <div className="mb-2">
            <p className="font-mono text-[10px] text-ink-35 mb-1">stdout</p>
            <pre className="font-mono text-[11px] text-ink-60 whitespace-pre-wrap bg-paper-2/30 rounded p-2">
              {stdout}
            </pre>
          </div>
        )}
        {stderr && (
          <div className="mb-2">
            <p className="font-mono text-[10px] text-confidence-low mb-1">stderr</p>
            <pre className="font-mono text-[11px] text-confidence-low whitespace-pre-wrap bg-paper-2/30 rounded p-2">
              {stderr}
            </pre>
          </div>
        )}
        {result !== null && !error && (
          <div className="mb-2">
            <p className="font-mono text-[10px] text-confidence-high mb-1">result</p>
            <pre className="font-mono text-[11px] text-ink-90 whitespace-pre-wrap bg-paper-2/30 rounded p-2">
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>

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
          try: &quot;show me what you just did&quot;
        </span>
      </div>
    </div>
  );
}
