"use client";

import { useCallback } from "react";
import { BookOpen } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { getWiki, type WikiNode } from "@/lib/kg-client";
import { cn } from "@/lib/cn";

function toTitle(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const LAYER_COLORS: Record<string, string> = {
  root: "bg-ink-60",
  integrations: "bg-accent-indigo",
  entities: "bg-confidence-high",
  chats: "bg-confidence-med",
  memories: "bg-confidence-low",
  skills: "bg-ink-35",
  workflows: "bg-ink-90",
};

export function WikiSideline({ win }: { win: WindowState }) {
  const userId = useAgentStore((s) => s.userId);
  const seed = (win.payload?.tree as WikiNode[] | undefined) ?? null;
  const activePath = (win.payload?.path as string) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) => getWiki(userId, signal),
    [userId],
  );

  const { data, loading } = useKgResource(fetcher, seed);
  const nodes = data ?? [];

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-rule/40 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-35">articles</span>
        <span className={cn("font-mono text-[10px] text-accent-indigo", loading && nodes.length === 0 ? "opacity-40" : "")}>
          {loading && nodes.length === 0 ? "—" : nodes.length}
        </span>
      </div>

      <div className="muji-scroll min-h-0 flex-1 overflow-y-auto">
        {nodes.length === 0 && !loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <BookOpen size={18} strokeWidth={1.25} className="text-ink-35 opacity-60" />
            <span className="font-mono text-[10px] text-ink-35">no articles yet</span>
          </div>
        ) : (
          <ul>
            {nodes.map((node, idx) => {
              const isActive = node.path === activePath;
              return (
                <li
                  key={node.path}
                  className={cn(
                    "px-3 py-2",
                    idx < nodes.length - 1 && "border-b border-rule/30",
                    isActive && "bg-accent-indigo-soft",
                  )}
                >
                  <div className="flex items-start gap-1.5">
                    <span
                      className={cn(
                        "mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full",
                        LAYER_COLORS[node.layer] ?? "bg-ink-35",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        "truncate font-mono text-[10px] leading-tight",
                        isActive ? "text-accent-indigo font-medium" : "text-ink-90",
                        node.depth > 1 && "pl-2",
                      )}>
                        {toTitle(node.path)}
                      </p>
                      <p className="font-mono text-[9px] text-ink-35 mt-0.5">{node.layer}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
