"use client";

import { SlidersHorizontal } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { cn } from "@/lib/cn";

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase leading-none tracking-[0.10em] text-ink-35 mb-0.5">
        {label}
      </p>
      <p className={cn("font-mono text-[11px] leading-snug", value ? "text-ink-90" : "text-ink-35")}>
        {value ?? "—"}
      </p>
      <div className="hairline mt-2" />
    </div>
  );
}

export function SettingsSideline({ win: _win }: { win: WindowState }) {
  const userId = useAgentStore((s) => s.userId);
  const quietMode = useAgentStore((s) => s.quietMode);
  const uiMode = useAgentStore((s) => s.uiMode);
  const backendHealth = useAgentStore((s) => s.backendHealth);
  const connections = useAgentStore((s) => s.connections);

  const connectedCount = connections.filter((c) => c.status === "ACTIVE").length;

  const surreal = backendHealth
    ? backendHealth.surrealOk ? "online" : "offline"
    : null;
  const composio = backendHealth
    ? backendHealth.composioOk ? "online" : "offline"
    : null;

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden px-3 py-3">
      <div className="mb-2.5 flex items-center gap-1.5 shrink-0">
        <SlidersHorizontal size={10} strokeWidth={1.5} className="text-ink-35" />
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-35">preferences</span>
      </div>

      <div className="min-h-0 flex-1 flex flex-col gap-2 overflow-hidden">
        <Row label="user id" value={userId ? userId.slice(0, 16) + (userId.length > 16 ? "…" : "") : null} />
        <Row label="ui mode" value={uiMode} />
        <Row label="quiet mode" value={quietMode ? "on" : "off"} />
        <Row label="integrations" value={connectedCount > 0 ? `${connectedCount} connected` : "none"} />
        <Row label="surrealdb" value={surreal} />
        <Row label="composio" value={composio} />
      </div>
    </div>
  );
}
