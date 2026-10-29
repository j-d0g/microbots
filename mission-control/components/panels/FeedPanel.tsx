"use client";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Bell, ChevronRight, Waypoints } from "lucide-react";
import type { FeedEvent } from "@/lib/types";
import { useMC, useAgentMap } from "@/lib/client/hooks";
import { Empty } from "@/components/ui";
import { clock, ms, tokens, usd } from "@/lib/client/format";

type Tab = "alerts" | "activity" | "traces";
const LEVEL = { info: "#5f7594", important: "#ffb547", urgent: "#ff5d7a" };

export function FeedPanel() {
  const feed = useMC((s) => s.snapshot?.feed ?? []);
  const [tab, setTab] = useState<Tab>("alerts");
  const llm = feed.filter((e) => e.kind === "llm");
  const tools = feed.filter((e) => e.kind === "tool");
  const tok = llm.reduce((n, e) => n + num(e.data?.inputTokens) + num(e.data?.outputTokens), 0);
  const cost = llm.reduce((n, e) => n + num(e.data?.costUsd), 0);
  const fails = tools.filter((e) => e.data?.ok === false).length;
  const alerts = feed.filter((e) => e.kind === "notification");
  return (
    <div className="panel flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-4 gap-px border-b border-line px-3 pt-3 pb-3">
        <Metric label="tokens" value={tokens(tok)} />
        <Metric label="cost" value={usd(cost)} />
        <Metric label="tools" value={String(tools.length)} />
        <Metric label="errors" value={String(fails)} warn={fails > 0} />
      </div>
      <div className="flex gap-1 px-3 pt-2.5">
        <TabBtn on={tab === "alerts"} onClick={() => setTab("alerts")} icon={<Bell size={12} />} label="Alerts" n={alerts.filter((a) => a.level !== "info").length} />
        <TabBtn on={tab === "activity"} onClick={() => setTab("activity")} icon={<Activity size={12} />} label="Activity" />
        <TabBtn on={tab === "traces"} onClick={() => setTab("traces")} icon={<Waypoints size={12} />} label="Traces" />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {tab === "alerts" && <EventList events={alerts} />}
        {tab === "activity" && <EventList events={feed.filter((e) => e.kind !== "llm")} dense />}
        {tab === "traces" && <Traces feed={feed} />}
      </div>
    </div>
  );
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="px-1">
      <div className={`font-mono text-[15px] font-semibold ${warn ? "text-rose" : "text-ink"}`}>{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-3">{label}</div>
    </div>
  );
}

function TabBtn({ on, onClick, icon, label, n }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; n?: number }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] transition ${on ? "bg-arc/10 text-arc-2" : "text-ink-3 hover:text-ink-2"}`}>
      {icon}
      {label}
      {!!n && <span className="rounded-full bg-rose/20 px-1.5 font-mono text-[9.5px] text-rose">{n}</span>}
    </button>
  );
}

function EventList({ events, dense }: { events: FeedEvent[]; dense?: boolean }) {
  const agents = useAgentMap();
  const list = [...events].reverse().slice(0, 120);
  if (!list.length) return <Empty>Nothing yet</Empty>;
  return (
    <div className="space-y-1">
      <AnimatePresence initial={false}>
        {list.map((e) => {
          const a = e.agentId ? agents[e.agentId] : undefined;
          return (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: -6, backgroundColor: "rgba(56,225,255,0.10)" }}
              animate={{ opacity: 1, y: 0, backgroundColor: "rgba(56,225,255,0)" }}
              transition={{ duration: 0.8 }}
              className={`flex gap-2 rounded-md px-2 ${dense ? "py-1" : "py-2"}`}
            >
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: e.kind === "notification" ? LEVEL[e.level] : a?.color ?? "#5f7594" }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  {a && <span className="text-[11px] font-semibold" style={{ color: a.color }}>{a.name}</span>}
                  {e.kind === "tool" && <span className="font-mono text-[10px] text-ink-3">{String(e.data?.tool ?? "tool")}()</span>}
                  <span className="ml-auto shrink-0 font-mono text-[9.5px] text-ink-3">{clock(e.ts)}</span>
                </div>
                <div className={`leading-snug ${dense ? "text-[11.5px] text-ink-2" : "text-[12.5px] text-ink"}`}>{e.title}</div>
                {!dense && e.body && <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{e.body}</div>}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function Traces({ feed }: { feed: FeedEvent[] }) {
  const agents = useAgentMap();
  const tasks = useMC((s) => s.snapshot?.tasks ?? []);
  const [open, setOpen] = useState<string | null>(null);
  const runs = useMemo(() => {
    const m = new Map<string, FeedEvent[]>();
    for (const e of feed) if (e.runId && (e.kind === "llm" || e.kind === "tool")) m.set(e.runId, [...(m.get(e.runId) ?? []), e]);
    return [...m.entries()].map(([id, evs]) => ({ id, evs, last: evs[evs.length - 1].ts })).sort((a, b) => b.last - a.last).slice(0, 40);
  }, [feed]);
  if (!runs.length) return <Empty>No traces yet</Empty>;
  return (
    <div className="space-y-1.5">
      {runs.map((r) => {
        const first = r.evs[0];
        const a = first.agentId ? agents[first.agentId] : undefined;
        const t = first.taskId ? tasks.find((x) => x.id === first.taskId) : undefined;
        const llm = r.evs.filter((e) => e.kind === "llm");
        const tok = llm.reduce((n, e) => n + num(e.data?.inputTokens) + num(e.data?.outputTokens), 0);
        const cost = llm.reduce((n, e) => n + num(e.data?.costUsd), 0);
        const dur = r.evs.reduce((n, e) => n + num(e.data?.ms), 0);
        const bad = r.evs.some((e) => e.data?.ok === false);
        const isOpen = open === r.id;
        return (
          <div key={r.id} className="card overflow-hidden">
            <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => setOpen(isOpen ? null : r.id)}>
              <ChevronRight size={12} className={`shrink-0 text-ink-3 transition ${isOpen ? "rotate-90" : ""}`} />
              <span className="text-[11.5px] font-semibold" style={{ color: a?.color }}>{a?.name ?? "run"}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{t?.title ?? "shepherd turn"}</span>
              {bad && <span className="h-1.5 w-1.5 rounded-full bg-rose" />}
            </button>
            <div className="flex gap-3 px-2.5 pb-2 pl-7 font-mono text-[10px] text-ink-3">
              <span>{llm.length} steps</span><span>{tokens(tok)} tok</span><span>{usd(cost)}</span><span>{ms(dur)}</span>
            </div>
            {isOpen && (
              <div className="border-t border-line bg-void/40 px-2.5 py-2">
                {r.evs.map((e) => (
                  <div key={e.id} className="flex items-baseline gap-2 py-0.5 font-mono text-[10.5px]">
                    <span className={e.kind === "llm" ? "text-violet" : e.data?.ok === false ? "text-rose" : "text-arc"}>{e.kind === "llm" ? "llm" : "tool"}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{e.kind === "llm" ? `${String(e.data?.model ?? "")} · ${num(e.data?.inputTokens)}→${num(e.data?.outputTokens)}` : String(e.data?.tool ?? e.title)}</span>
                    <span className="text-ink-3">{ms(num(e.data?.ms))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
