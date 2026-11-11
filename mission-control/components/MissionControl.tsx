"use client";
import { useEffect, useRef } from "react";
import { Bot, KanbanSquare, Sparkles } from "lucide-react";
import type { View } from "@/lib/types";
import { useConnected, useLiveState, useMC } from "@/lib/client/hooks";
import { useUI } from "@/lib/client/ui-store";
import { TopBar } from "./panels/TopBar";
import { TodayPanel } from "./panels/TodayPanel";
import { FeedPanel } from "./panels/FeedPanel";
import { Stage } from "./stage/Stage";
import { AgentBoard } from "./boards/AgentBoard";
import { TaskBoard } from "./boards/TaskBoard";
import { TaskDetail } from "./boards/TaskDetail";
import { VoiceDock } from "./voice/VoiceDock";
import { VoiceEngine } from "./voice/VoiceEngine";

export function MissionControl() {
  useLiveState();
  const snap = useMC((s) => s.snapshot);
  const connected = useConnected();
  const view = useUI((s) => s.view);
  const set = useUI((s) => s.set);
  const serverView = snap.stage.view;
  const lastServerView = useRef<View | undefined>(undefined);
  useEffect(() => {
    // Follow the shepherd's navigate() calls; the user can still switch tabs freely.
    if (serverView && serverView !== lastServerView.current) {
      if (lastServerView.current !== undefined) set({ view: serverView });
      lastServerView.current = serverView;
    }
  }, [serverView, set]);

  const needs = snap.agents.filter((a) => a.status === "needs_you").length;
  const running = snap.agents.filter((a) => a.status === "running").length;
  const open = snap.tasks.filter((t) => t.status !== "done").length;
  const tabs: { id: View; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { id: "stage", label: "Stage", icon: <Sparkles size={13} /> },
    {
      id: "agents",
      label: "Agents",
      icon: <Bot size={13} />,
      badge: needs ? <span className="rounded-full bg-rose/20 px-1.5 font-mono text-[10px] text-rose">{needs}</span> : running ? <span className="font-mono text-[10px] text-arc">{running}▸</span> : null,
    },
    { id: "tasks", label: "Tasks", icon: <KanbanSquare size={13} />, badge: <span className="font-mono text-[10px] text-ink-3">{open}</span> },
  ];

  return (
    <div className="hud-bg relative flex h-screen flex-col">
      <div className="hud-grid" />
      <TopBar />
      <main className="relative grid min-h-0 flex-1 grid-cols-[290px_minmax(0,1fr)_330px] gap-3 px-3 pb-3 2xl:grid-cols-[330px_minmax(0,1fr)_380px]">
        <TodayPanel />
        <section className="flex min-h-0 flex-col gap-3">
          <div className="panel flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-1 border-b border-line px-3 py-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => set({ view: t.id })}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] transition ${view === t.id ? "bg-arc/10 text-arc-2 shadow-[inset_0_-2px_0_#38e1ff]" : "text-ink-3 hover:text-ink-2"}`}
                >
                  {t.icon}
                  {t.label}
                  {t.badge}
                </button>
              ))}
            </div>
            <div className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
              {!connected && snap.agents.length === 0 ? (
                <div className="flex h-full items-center justify-center font-mono text-xs text-ink-3">connecting…</div>
              ) : view === "stage" ? (
                <Stage />
              ) : view === "agents" ? (
                <AgentBoard />
              ) : (
                <TaskBoard />
              )}
            </div>
          </div>
          <VoiceDock />
        </section>
        <FeedPanel />
      </main>
      <TaskDetail />
      <VoiceEngine />
    </div>
  );
}
