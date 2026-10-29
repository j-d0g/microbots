"use client";
import type { Widget } from "@/lib/widgets";
import { useMC, useAgentMap } from "@/lib/client/hooks";
import { AgentAvatar, AgentChip, PriorityChip } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { AskCard } from "@/components/boards/AskCard";
import { actions } from "@/lib/client/actions";
import { ago } from "@/lib/client/format";

const TONE: Record<string, string> = { good: "#5cf2a5", warn: "#ffb547", bad: "#ff5d7a", neutral: "#38e1ff" };

function Title({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 text-[13px] font-semibold tracking-wide text-ink">{children}</div>;
}

export function WidgetView({ w }: { w: Widget }) {
  const agents = useAgentMap();
  const snapshot = useMC((s) => s.snapshot);
  switch (w.kind) {
    case "brief":
      return (
        <div>
          <Title>{w.title}</Title>
          <ul className="space-y-2">
            {w.bullets.map((b, i) => (
              <li key={i} className="flex gap-3 text-[13.5px] leading-snug text-ink-2">
                <span className="mt-[7px] h-1 w-3 shrink-0 rounded-full bg-arc/70 shadow-[0_0_8px_#38e1ff]" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "stats":
      return (
        <div>
          {w.title && <Title>{w.title}</Title>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {w.items.map((s, i) => {
              const c = TONE[s.tone ?? "neutral"];
              return (
                <div key={i} className="rounded-lg border border-line bg-deep/60 px-3 py-2.5">
                  <div className="label !text-[9.5px]">{s.label}</div>
                  <div className="mt-1 font-mono text-2xl font-semibold" style={{ color: c, textShadow: `0 0 16px ${c}55` }}>
                    {s.value}
                  </div>
                  {s.delta && <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">{s.delta}</div>}
                </div>
              );
            })}
          </div>
        </div>
      );
    case "list":
      return (
        <div>
          <Title>{w.title}</Title>
          <div className="space-y-1.5">
            {w.items.map((it, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-md border border-line/70 bg-deep/40 px-3 py-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TONE[it.tone ?? "neutral"] }} />
                <div className="min-w-0">
                  <div className="text-[13px] text-ink">{it.title}</div>
                  {it.subtitle && <div className="text-[11.5px] text-ink-3">{it.subtitle}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "timeline":
      return (
        <div>
          <Title>{w.title}</Title>
          <div className="relative ml-1.5 border-l border-line-2 pl-4">
            {w.events.map((e, i) => {
              const a = e.agentId ? agents[e.agentId] : undefined;
              const c = a?.color ?? "#38e1ff";
              return (
                <div key={i} className="relative pb-3 last:pb-0">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-void" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                  <div className="font-mono text-[10.5px] text-ink-3">
                    {e.time}
                    {a && <span style={{ color: c }}> · {a.name}</span>}
                  </div>
                  <div className="text-[13px] text-ink-2">{e.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      );
    case "chart":
      return <Chart w={w} />;
    case "decision": {
      const task = w.taskId ? snapshot?.tasks.find((t) => t.id === w.taskId) : undefined;
      return (
        <div>
          <div className="mb-1 label !text-rose/90">Decision</div>
          <Title>{w.question}</Title>
          <div className="grid gap-2 sm:grid-cols-2">
            {w.options.map((o) => (
              <button
                key={o.label}
                className="card px-3 py-2.5 text-left hover:!border-arc/60"
                onClick={() => (task ? actions.answer(task.id, o.label) : actions.command(o.label))}
              >
                <div className="text-[13px] font-medium text-ink">{o.label}</div>
                {o.hint && <div className="text-[11.5px] text-ink-3">{o.hint}</div>}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "agent": {
      const a = agents[w.agentId];
      if (!a) return <div className="text-xs text-ink-3">Unknown agent</div>;
      const task = a.currentTaskId ? snapshot?.tasks.find((t) => t.id === a.currentTaskId) : undefined;
      return (
        <div className="flex gap-3">
          <AgentAvatar agent={a} size={44} />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold" style={{ color: a.color }}>{a.name}</div>
            <div className="text-[12px] text-ink-3">{a.role}</div>
            {task && <div className="mt-2 text-[13px] text-ink-2">Working on: {task.title}</div>}
            {a.lastLine && <div className="mt-1 font-mono text-[11.5px] text-ink-3">› {a.lastLine}</div>}
          </div>
        </div>
      );
    }
    case "task": {
      const t = snapshot?.tasks.find((x) => x.id === w.taskId);
      if (!t) return <div className="text-xs text-ink-3">Unknown task</div>;
      return (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <PriorityChip p={t.priority} />
            <AgentChip agent={t.agentId ? agents[t.agentId] : null} />
            <span className="chip">{t.status}</span>
            <span className="chip">{ago(t.updatedAt)}</span>
          </div>
          <Title>{t.title}</Title>
          {t.result && <Markdown text={t.result} />}
          {t.ask && !t.ask.answer && <AskCard task={t} />}
        </div>
      );
    }
    case "markdown":
      return (
        <div>
          <Title>{w.title}</Title>
          <Markdown text={w.body} />
        </div>
      );
  }
}

function Chart({ w }: { w: Extract<Widget, { kind: "chart" }> }) {
  const W = 420;
  const H = 150;
  const pad = 22;
  const max = Math.max(1, ...w.series.map((s) => s.value));
  const step = (W - pad * 2) / w.series.length;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const pts = w.series.map((s, i) => [pad + step * i + step / 2, y(s.value)] as const);
  return (
    <div>
      <Title>
        {w.title}
        {w.unit && <span className="ml-2 font-mono text-[10.5px] font-normal text-ink-3">{w.unit}</span>}
      </Title>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <linearGradient id="bar" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#7cf3ff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#38e1ff" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad} x2={W - pad} y1={y(max * f)} y2={y(max * f)} stroke="#16263f" strokeDasharray="2 4" />
        ))}
        {w.type === "bar"
          ? w.series.map((s, i) => (
              <rect key={i} x={pad + step * i + step * 0.2} width={step * 0.6} y={y(s.value)} height={H - pad - y(s.value)} rx={3} fill="url(#bar)" />
            ))
          : (
            <>
              <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#38e1ff" strokeWidth={2} style={{ filter: "drop-shadow(0 0 6px #38e1ff)" }} />
              {pts.map(([x, yy], i) => <circle key={i} cx={x} cy={yy} r={3} fill="#04070d" stroke="#7cf3ff" strokeWidth={1.5} />)}
            </>
          )}
        {w.series.map((s, i) => (
          <text key={i} x={pad + step * i + step / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#5f7594" fontFamily="monospace">
            {s.label.slice(0, 6)}
          </text>
        ))}
      </svg>
    </div>
  );
}
