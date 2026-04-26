"use client";

/**
 * view_workflow window — rendered source code with syntax highlighting.
 *
 * Shows workflow name, code, last-edited timestamp.
 */

import { cn } from "@/lib/cn";

export function ViewWorkflowWindow({ payload }: { payload?: Record<string, unknown> }) {
  const name = (payload?.name as string) ?? "?";
  const slug = (payload?.slug as string) ?? name;
  const code = (payload?.code as string) ?? "";
  const bytes = (payload?.bytes as number) ?? 0;
  const modifiedAt = (payload?.modified_at as string) ?? null;
  const error = (payload?.error as string | null) ?? null;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <p className="font-mono text-[11px] text-confidence-low mb-2">{error}</p>
        <p className="font-mono text-[10px] text-ink-35">
          try: &quot;list workflows&quot;
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto muji-scroll p-3">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
              view_workflow
            </p>
            <p className="font-mono text-[14px] text-ink-90 mt-1">{name}</p>
          </div>
          {modifiedAt && (
            <p className="font-mono text-[10px] text-ink-35">
              {new Date(modifiedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        <pre className="font-mono text-[12px] text-ink-90 whitespace-pre-wrap leading-relaxed bg-paper-2/50 rounded p-3">
          {code}
        </pre>

        {bytes > 0 && (
          <p className="font-mono text-[10px] text-ink-35 mt-2">{bytes} bytes</p>
        )}
      </div>

      <div className="shrink-0 border-t border-rule/50 px-3 py-2">
        <span className="font-mono text-[10px] text-ink-35">
          try: &quot;update it to also post to Slack&quot;
        </span>
      </div>
    </div>
  );
}
