"use client";

/**
 * find_examples window — grid of example cards with tag chips.
 *
 * Click-through to view_workflow(example.slug).
 */

import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

interface ExampleEntry {
  id: string;
  title: string;
  description: string;
  tags: string[];
  code: string;
}

export function FindExamplesWindow({ payload }: { payload?: Record<string, unknown> }) {
  const query = (payload?.query as string) ?? "";
  const count = (payload?.count as number) ?? 0;
  const matches = (payload?.matches as ExampleEntry[]) ?? [];
  const status = (payload?.status as string) ?? "pending";

  const openWindow = useAgentStore((s) => s.openWindow);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto muji-scroll p-3">
        <div className="flex items-baseline justify-between mb-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
            find_examples
          </p>
          <p className="font-mono text-[10px] text-ink-35">
            {count} match{count !== 1 ? "es" : ""}
            {query && ` for "${query}"`}
          </p>
        </div>

        {matches.length === 0 ? (
          <p className="font-mono text-[12px] text-ink-35 text-center py-8">
            no examples found
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {matches.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => openWindow("view_workflow", { payload: { name: ex.id, code: ex.code } })}
                className={cn(
                  "text-left px-3 py-3 rounded border border-rule/50",
                  "hover:border-accent-indigo/30 hover:bg-paper-2/50",
                  "transition-all duration-150",
                )}
              >
                <p className="font-mono text-[12px] text-ink-90 font-medium">
                  {ex.title}
                </p>
                <p className="font-mono text-[11px] text-ink-60 mt-1 line-clamp-2">
                  {ex.description}
                </p>
                {ex.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {ex.tags.map((tag) => (
                      <span
                        key={tag}
                        className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-paper-2 text-ink-35"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-rule/50 px-3 py-2">
        <span className="font-mono text-[10px] text-ink-35">
          try: &quot;build something like this&quot;
        </span>
      </div>
    </div>
  );
}
