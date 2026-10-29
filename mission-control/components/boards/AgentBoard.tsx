"use client";
import { motion } from "motion/react";
import { X } from "lucide-react";
import type { Agent, AgentStatus, TaskStatus } from "@/lib/types";
import { useMC } from "@/lib/client/hooks";
import { useUI } from "@/lib/client/ui-store";
import { AgentAvatar, Empty, PriorityChip } from "@/components/ui";
import { AskCard } from "./AskCard";
import { ago, tokens, usd } from "@/lib/client/format";

const COLS: { id: AgentStatus; label: string; color: string }[] = [
  { id: "needs_you", label: "Needs you", color: "#ff5d7a" },
  { id: "running", label: "Running", color: "#38e1ff" },
  { id: "review", label: "Review", color: "#ffb547" },
  { id: "idle", label: "Idle", color: "#5f7594" },
];

export function AgentBoard() {
  const snap = useMC((s) => s.snapshot);
  const selected = useUI((s) => s.selectedAgentId);
  const set = useUI((s) => s.set);
  if (!snap) return null;
  // An idle agent with work waiting for review shows in Review.
  const col = (a: Agent): AgentStatus =>
    a.status === "idle" && snap.tasks.some((t) => t.agentId === a.id && t.status === "review") ? "review" : a.status;
  const agents = snap.agents;
  const sel = agents.find((a) => a.id === selected);
  return (
    <div className="relative h-full">
      <div className="grid h-full grid-cols-4 gap-3 p-4">
        {COLS.map((c) => {
          const list = agents.filter((a) => col(a) === c.id);
          return (
            <div key={c.id} className="flex min-h-0 flex-col rounded-xl border border-line/70 bg-deep/40" style={{ boxShadow: `inset 0 2px 0 ${c.color}55` }}>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="label" style={{ color: c.color }}>{c.label}</span>
                <span className="font-mono text-[11px] text-ink-3">{list.length}</span>
              </div>
              <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {list.length === 0 && <Empty>—</Empty>}
                {list.map((a) => (
                  <AgentCard key={a.id} agent={a} onOpen={() => set({ selectedAgentId: a.id })} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {sel && <AgentDetail agent={sel} onClose={() => set({ selectedAgentId: null })} />}
    </div>
  );
}

function AgentCard({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const tasks = useMC((s) => s.snapshot?.tasks ?? []);
  const current = agent.currentTaskId ? tasks.find((t) => t.id === agent.currentTaskId) : undefined;
  const ask = tasks.find((t) => t.agentId === agent.id && t.ask && !t.ask.answer);
  const open = tasks.filter((t) => t.agentId === agent.id && t.status !== "done").length;
  return (
    <motion.div layout layoutId={`agent-${agent.id}`} className={`card cursor-pointer p-3 ${agent.status === "running" ? "scanbar" : ""}`} onClick={onOpen}>
      <div className="flex items-center gap-2.5">
        <AgentAvatar agent={agent} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold" style={{ color: agent.color }}>{agent.name}</div>
          <div className="truncate text-[11px] text-ink-3">{agent.role}</div>
        </div>
      </div>
      {current && <div className="mt-2 text-[12.5px] leading-snug text-ink-2">{current.title}</div>}
      {agent.lastLine && <div className="mt-1 truncate font-mono text-[10.5px] text-ink-3">› {agent.lastLine}</div>}
      {ask && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <AskCard task={ask} compact />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-ink-3">
        <span>{open} open</span>
        <span>·</span>
        <span>{tokens(agent.tokens)} tok</span>
        <span>·</span>
        <span>{usd(agent.costUsd)}</span>
        <span className="ml-auto">{ago(agent.updatedAt)}</span>
      </div>
    </motion.div>
  );
}

const TCOLS: TaskStatus[] = ["todo", "doing", "review", "done"];

function AgentDetail({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const snap = useMC((s) => s.snapshot);
  const set = useUI((s) => s.set);
  if (!snap) return null;
  const tasks = snap.tasks.filter((t) => t.agentId === agent.id);
  const feed = snap.feed.filter((e) => e.agentId === agent.id && (e.kind === "log" || e.kind === "notification")).slice(-8).reverse();
  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      className="absolute inset-y-3 right-3 z-20 flex w-[min(560px,92%)] flex-col rounded-xl border border-line-2 bg-panel/95 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-start gap-3 border-b border-line p-4">
        <AgentAvatar agent={agent} size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold" style={{ color: agent.color }}>{agent.name}</div>
          <div className="text-[12px] text-ink-2">{agent.role}</div>
          <div className="mt-1 text-[11.5px] text-ink-3">Goal: {agent.goal}</div>
        </div>
        <button className="btn !p-1.5" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        <div className="label mb-2">Its board</div>
        <div className="grid grid-cols-4 gap-2">
          {TCOLS.map((c) => (
            <div key={c} className="rounded-lg border border-line/70 bg-deep/40 p-1.5">
              <div className="mb-1 px-1 font-mono text-[9.5px] uppercase tracking-wider text-ink-3">{c}</div>
              {tasks.filter((t) => t.status === c).map((t) => (
                <button key={t.id} onClick={() => set({ openTaskId: t.id })} className="card mb-1.5 block w-full p-2 text-left">
                  <PriorityChip p={t.priority} />
                  <div className="mt-1 text-[11.5px] leading-snug text-ink-2">{t.title}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="label mt-4 mb-2">Recent</div>
        <div className="space-y-1.5">
          {feed.length === 0 && <Empty>No activity yet</Empty>}
          {feed.map((e) => (
            <div key={e.id} className="flex gap-2 text-[12px]">
              <span className="w-8 shrink-0 font-mono text-[10.5px] text-ink-3">{ago(e.ts)}</span>
              <span className="text-ink-2">{e.title}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
