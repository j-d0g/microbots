"use client";
import type { ReactNode } from "react";
import type { Agent, Priority } from "@/lib/types";

export function PanelHeader({ title, right, icon }: { title: string; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
      <div className="flex items-center gap-2">
        {icon && <span className="text-arc/80">{icon}</span>}
        <span className="label">{title}</span>
      </div>
      {right}
    </div>
  );
}

export function AgentAvatar({ agent, size = 28, live }: { agent: Pick<Agent, "name" | "color" | "status">; size?: number; live?: boolean }) {
  const running = live ?? agent.status === "running";
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-mono font-semibold ${running ? "pulse" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        color: agent.color,
        background: `radial-gradient(circle at 35% 30%, ${agent.color}33, ${agent.color}0d 70%)`,
        border: `1px solid ${agent.color}88`,
        ["--c" as string]: agent.color,
      }}
    >
      {agent.name.slice(0, 1).toUpperCase()}
      {agent.status === "needs_you" && (
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-rose ring-2 ring-void" />
      )}
    </span>
  );
}

const PRIO: Record<Priority, { label: string; color: string }> = {
  p0: { label: "P0", color: "#ff5d7a" },
  p1: { label: "P1", color: "#ffb547" },
  p2: { label: "P2", color: "#38e1ff" },
  p3: { label: "P3", color: "#5f7594" },
};

export function PriorityChip({ p }: { p: Priority }) {
  const { label, color } = PRIO[p];
  return (
    <span className="chip" style={{ color, borderColor: `${color}66`, background: `${color}12` }}>
      {label}
    </span>
  );
}

export function AgentChip({ agent }: { agent?: Agent | null }) {
  if (!agent) return <span className="chip opacity-60">unassigned</span>;
  return (
    <span className="chip" style={{ color: agent.color, borderColor: `${agent.color}55` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: agent.color }} />
      {agent.name}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-xs text-ink-3">{children}</div>;
}
