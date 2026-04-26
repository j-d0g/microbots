"use client";

import { Zap, CheckCircle2, XCircle } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { cn } from "@/lib/cn";

export function IntegrationDetailSideline({ win }: { win: WindowState }) {
  const connections = useAgentStore((s) => s.connections);

  const slug = (win.payload?.slug as string) ?? "";
  const appName = (win.payload?.name as string) ?? slug;
  const category = (win.payload?.category as string) ?? null;
  const skills = (win.payload?.skills as { id: string; name: string }[]) ?? [];

  const connectionEntry = connections.find((c) => c.slug === slug);
  const isConnected = connectionEntry?.status === "ACTIVE";
  const statusLabel =
    connectionEntry?.status === "ACTIVE"
      ? "connected"
      : connectionEntry?.status === "INITIATED"
        ? "initiated"
        : connectionEntry?.status === "EXPIRED"
          ? "expired"
          : connectionEntry?.status === "FAILED"
            ? "failed"
            : "disconnected";

  if (!appName) {
    return (
      <div className="pointer-events-none flex h-full items-center justify-center p-4">
        <p className="font-mono text-[10px] text-ink-35">no integration</p>
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      {/* App identity */}
      <div className="px-3 pb-2.5 pt-3">
        <p className="truncate font-mono text-[15px] font-medium leading-tight text-ink-90" title={appName}>
          {appName}
        </p>
        {category && (
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-35">
            {category}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          {isConnected ? (
            <CheckCircle2 size={10} strokeWidth={2} className="shrink-0 text-confidence-high" />
          ) : (
            <XCircle size={10} strokeWidth={2} className="shrink-0 text-ink-35" />
          )}
          <span className={cn("font-mono text-[10px] uppercase tracking-[0.08em]", isConnected ? "text-confidence-high" : "text-ink-35")}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="hairline mx-3 shrink-0" />

      {/* Actions list */}
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2.5">
        {skills.length === 0 ? (
          <p className="font-mono text-[10px] text-ink-35">no actions loaded</p>
        ) : (
          <>
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-35">
              actions · {skills.length}
            </p>
            <ul className="space-y-1">
              {skills.map((skill) => (
                <li key={skill.id} className="flex items-center gap-1.5 rounded border border-rule/40 bg-paper-2/30 px-2 py-1">
                  <Zap size={9} strokeWidth={1.75} className="shrink-0 text-accent-indigo" />
                  <span className="truncate font-mono text-[10px] leading-tight text-ink-90" title={skill.name}>
                    {skill.name}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {slug && (
        <>
          <div className="hairline mx-3 shrink-0" />
          <div className="px-3 py-2">
            <p className="truncate font-mono text-[9px] text-ink-35" title={slug}>{slug}</p>
          </div>
        </>
      )}
    </div>
  );
}
