"use client";

import { Plug } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { cn } from "@/lib/cn";

export function IntegrationsSideline({ win: _win }: { win: WindowState }) {
  const connections = useAgentStore((s) => s.connections);
  const connectedCount = connections.filter((c) => c.status === "ACTIVE").length;

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      {/* Count header */}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-35">
          {connectedCount === 0
            ? "none connected"
            : connectedCount === 1
              ? "1 connected"
              : `${connectedCount} connected`}
        </span>
      </div>

      <div className="hairline shrink-0" />

      {connections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
          <Plug size={14} strokeWidth={1.25} className="text-ink-35" />
          <p className="font-mono text-[10px] leading-snug text-ink-35">
            no tools connected
          </p>
        </div>
      ) : (
        <ul className="muji-scroll min-h-0 flex-1 overflow-y-auto">
          {connections.map((conn, idx) => {
            const isActive = conn.status === "ACTIVE";
            return (
              <li key={conn.slug}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <Plug
                    size={10}
                    strokeWidth={1.5}
                    className={cn(
                      "shrink-0",
                      isActive ? "text-confidence-high" : "text-ink-35",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-90">
                    {conn.slug}
                  </span>
                  <span
                    aria-label={isActive ? "connected" : "disconnected"}
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      isActive ? "bg-confidence-high" : "bg-ink-35",
                    )}
                  />
                </div>
                {idx < connections.length - 1 && (
                  <div className="hairline mx-3" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
