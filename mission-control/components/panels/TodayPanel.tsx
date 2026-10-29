"use client";
import { motion } from "motion/react";
import { Compass, Lightbulb, Radio } from "lucide-react";
import { useMC, useAgentMap } from "@/lib/client/hooks";
import { useUI } from "@/lib/client/ui-store";
import { actions } from "@/lib/client/actions";
import { AskCard } from "@/components/boards/AskCard";
import { AgentAvatar, Empty, PanelHeader } from "@/components/ui";

export function TodayPanel() {
  const snap = useMC((s) => s.snapshot);
  const agents = useAgentMap();
  const set = useUI((s) => s.set);
  if (!snap) return <div className="panel h-full" />;
  const asks = snap.tasks.filter((t) => t.ask && !t.ask.answer);
  const open = snap.tasks.filter((t) => t.status !== "done");
  const doneToday = snap.tasks.filter((t) => t.status === "done" && Date.now() - t.updatedAt < 86_400_000).length;
  const now = new Date();
  return (
    <div className="panel flex h-full min-h-0 flex-col">
      <div className="px-4 pt-4">
        <div className="label">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}</div>
        <div className="mt-1 text-xl font-semibold tracking-tight">Today</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat n={asks.length} label="need you" color="#ff5d7a" />
          <Stat n={snap.agents.filter((a) => a.status === "running").length} label="running" color="#38e1ff" />
          <Stat n={open.length} label="open" color="#9fb3cf" sub={`${doneToday} done`} />
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        <PanelHeader title="Focus" icon={<Compass size={13} />} />
        <div className="space-y-1.5 px-3">
          {snap.focus.items.length === 0 && <Empty>Ask “what should I work on today?”</Empty>}
          {snap.focus.items.map((f, i) => (
            <motion.button
              key={f.title + i}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => f.taskId && set({ openTaskId: f.taskId })}
              className={`card flex w-full gap-3 p-3 text-left ${i === 0 ? "!border-arc/40 shadow-[0_0_24px_-8px_#38e1ff]" : ""}`}
            >
              <span className={`font-mono text-[18px] font-semibold leading-none ${i === 0 ? "text-arc glow-text" : "text-ink-3"}`}>{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-snug text-ink">{f.title}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{f.why}</span>
              </span>
            </motion.button>
          ))}
        </div>

        {asks.length > 0 && (
          <>
            <PanelHeader title="Waiting on you" icon={<Radio size={13} />} right={<span className="font-mono text-[11px] text-rose">{asks.length}</span>} />
            <div className="space-y-2 px-3">
              {asks.map((t) => {
                const a = t.agentId ? agents[t.agentId] : undefined;
                return (
                  <div key={t.id}>
                    {a && (
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-3">
                        <AgentAvatar agent={a} size={16} /> <span style={{ color: a.color }}>{a.name}</span> · {t.title}
                      </div>
                    )}
                    <AskCard task={t} compact />
                  </div>
                );
              })}
            </div>
          </>
        )}

        <PanelHeader title="Recommendations" icon={<Lightbulb size={13} />} />
        <div className="space-y-1.5 px-3">
          {snap.focus.recommendations.length === 0 && <Empty>None yet</Empty>}
          {snap.focus.recommendations.map((r, i) => (
            <button key={r.title + i} className="card group block w-full p-3 text-left" onClick={() => actions.command(r.prompt)}>
              <span className="block text-[12.5px] font-medium text-ink group-hover:text-arc-2">{r.title}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{r.why}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, color, sub }: { n: number; label: string; color: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-deep/50 px-2.5 py-2">
      <div className="font-mono text-xl font-semibold" style={{ color, textShadow: n ? `0 0 14px ${color}66` : undefined }}>{n}</div>
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-3">{label}</div>
      {sub && <div className="font-mono text-[9.5px] text-ink-3/70">{sub}</div>}
    </div>
  );
}
