"use client";

/**
 * list_workflows window — ranked list with one-line descriptions.
 *
 * Click-through to view_workflow.
 */

import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

interface WorkflowEntry {
  slug: string;
  summary: string;
  bytes: number;
  modified_at: string;
}

export function ListWorkflowsWindow({ payload }: { payload?: Record<string, unknown> }) {
  const count = (payload?.count as number) ?? 0;
  const workflows = (payload?.workflows as WorkflowEntry[]) ?? [];
  const status = (payload?.status as string) ?? "pending";

  const openWindow = useAgentStore((s) => s.openWindow);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto muji-scroll p-3">
        <div className="flex items-baseline justify-between mb-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
            list_workflows
          </p>
          <p className="font-mono text-[10px] text-ink-35">{count} total</p>
        </div>

        {workflows.length === 0 ? (
          <p className="font-mono text-[12px] text-ink-35 text-center py-8">
            no workflows saved yet
          </p>
        ) : (
          <ul className="space-y-1">
            {workflows.map((wf) => (
              <li key={wf.slug}>
                <button
                  type="button"
                  onClick={() => openWindow("view_workflow", { payload: { name: wf.slug } })}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded",
                    "hover:bg-paper-2 transition-colors duration-150",
                    "group",
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[12px] text-ink-90 group-hover:text-accent-indigo transition-colors">
                      {wf.slug}
                    </span>
                    <span className="font-mono text-[10px] text-ink-35">
                      {wf.bytes}b
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-ink-60 mt-0.5 truncate">
                    {wf.summary}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-rule/50 px-3 py-2">
        <span className="font-mono text-[10px] text-ink-35">
          try: &quot;open bug-triage&quot;
        </span>
      </div>
    </div>
  );
}
