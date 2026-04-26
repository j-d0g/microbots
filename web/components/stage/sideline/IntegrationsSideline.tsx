"use client";

import { Link2, Plug } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { cn } from "@/lib/cn";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-confidence-high",
  INITIATED: "bg-yellow-400",
  EXPIRED: "bg-confidence-low",
  FAILED: "bg-confidence-low",
};

const TOOLKIT_ICONS: Record<string, string> = {
  slack: "🔷",
  github: "⚙️",
  gmail: "✉️",
  linear: "📋",
  notion: "📝",
  perplexityai: "🔍",
};

export function IntegrationsSideline({ win: _win }: { win: WindowState }) {
  const connections = useAgentStore((s) => s.connections);
  const openWindow = useAgentStore((s) => s.openWindow);
  const connectedCount = connections.filter((c) => c.status === "ACTIVE").length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Count header */}
      <div className="flex shrink-0 items-center justify-between px-3 pb-1.5 pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-35">
          {connectedCount === 0
            ? "none connected"
            : connectedCount === 1
              ? "1 connected"
              : `${connectedCount} connected`}
        </span>
        <button
          type="button"
          onClick={() => openWindow("composio_connect")}
          className="pointer-events-auto flex items-center gap-1 rounded border border-accent-indigo/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-indigo transition-colors hover:border-accent-indigo hover:bg-accent-indigo/10"
          title="manage connections"
        >
          <Link2 size={9} />
          connect
        </button>
      </div>

      <div className="hairline shrink-0" />

      {connections.length === 0 ? (
        <div className="pointer-events-none flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
          <Plug size={14} strokeWidth={1.25} className="text-ink-35" />
          <p className="font-mono text-[10px] leading-snug text-ink-35">
            no tools connected
          </p>
        </div>
      ) : (
        <ul className="muji-scroll pointer-events-none min-h-0 flex-1 overflow-y-auto">
          {connections.map((conn, idx) => {
            const isActive = conn.status === "ACTIVE";
            const icon = TOOLKIT_ICONS[conn.slug];
            const dotColor = STATUS_COLORS[conn.status] ?? "bg-ink-35";
            return (
              <li key={conn.slug}>
                <div className="flex items-center gap-2 px-3 py-2">
                  {icon ? (
                    <span className="shrink-0 text-[11px]" aria-hidden>
                      {icon}
                    </span>
                  ) : (
                    <Plug
                      size={10}
                      strokeWidth={1.5}
                      className={cn(
                        "shrink-0",
                        isActive ? "text-confidence-high" : "text-ink-35",
                      )}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-90">
                    {conn.slug}
                  </span>
                  <span
                    aria-label={conn.status}
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotColor)}
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
