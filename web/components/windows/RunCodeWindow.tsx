"use client";

/**
 * run_code window — streaming code display + stdout/stderr/return pane.
 *
 * Shows the code being executed, stdout/stderr output, return value,
 * and timing. "Copy to save_workflow" action at bottom.
 */

import { useState } from "react";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function RunCodeWindow({ payload }: { payload?: Record<string, unknown> }) {
  const code = (payload?.code as string) ?? "";
  const stdout = (payload?.stdout as string) ?? "";
  const stderr = (payload?.stderr as string) ?? "";
  const result = payload?.result ?? null;
  const error = (payload?.error as string | null) ?? null;
  const status = (payload?.status as string) ?? "pending";

  const openWindow = useAgentStore((s) => s.openWindow);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Code section */}
      <div className="flex-1 min-h-0 overflow-auto muji-scroll p-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35 mb-2">
          code
        </p>
        <pre className="font-mono text-[12px] text-ink-90 whitespace-pre-wrap leading-relaxed bg-paper-2/50 rounded p-3">
          {code || "// waiting for code..."}
        </pre>

        {/* Output */}
        {(stdout || stderr || result !== null || error) && (
          <div className="mt-3 space-y-2">
            {stdout && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35 mb-1">
                  stdout
                </p>
                <pre className="font-mono text-[11px] text-ink-60 whitespace-pre-wrap bg-paper-2/30 rounded p-2">
                  {stdout}
                </pre>
              </div>
            )}
            {stderr && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-confidence-low mb-1">
                  stderr
                </p>
                <pre className="font-mono text-[11px] text-confidence-low whitespace-pre-wrap bg-paper-2/30 rounded p-2">
                  {stderr}
                </pre>
              </div>
            )}
            {error && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-confidence-low mb-1">
                  error
                </p>
                <pre className="font-mono text-[11px] text-confidence-low whitespace-pre-wrap bg-paper-2/30 rounded p-2">
                  {error}
                </pre>
              </div>
            )}
            {result !== null && !error && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-confidence-high mb-1">
                  result
                </p>
                <pre className="font-mono text-[11px] text-ink-90 whitespace-pre-wrap bg-paper-2/30 rounded p-2">
                  {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-rule/50 px-3 py-2 flex items-center justify-between">
        <span className={cn(
          "font-mono text-[10px] uppercase tracking-wider",
          status === "done" ? "text-confidence-high" : "text-ink-35",
        )}>
          {status}
        </span>
        <button
          type="button"
          onClick={() => openWindow("save_workflow", { payload: { code } })}
          className="font-mono text-[10px] text-accent-indigo hover:underline"
        >
          save as workflow
        </button>
      </div>
    </div>
  );
}
