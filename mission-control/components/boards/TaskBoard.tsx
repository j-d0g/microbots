"use client";
import { useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import type { Task, TaskStatus } from "@/lib/types";
import { useMC, useAgentMap } from "@/lib/client/hooks";
import { useUI } from "@/lib/client/ui-store";
import { actions } from "@/lib/client/actions";
import { AgentChip, PriorityChip } from "@/components/ui";
import { ago } from "@/lib/client/format";

const COLS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "#5f7594" },
  { id: "todo", label: "To do", color: "#9fb3cf" },
  { id: "doing", label: "Doing", color: "#38e1ff" },
  { id: "review", label: "Review", color: "#ffb547" },
  { id: "done", label: "Done", color: "#5cf2a5" },
];
const PRANK = { p0: 0, p1: 1, p2: 2, p3: 3 };

export function TaskBoard() {
  const tasks = useMC((s) => s.snapshot?.tasks ?? []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const to = e.over?.id as TaskStatus | undefined;
    const t = tasks.find((x) => x.id === id);
    if (t && to && t.status !== to) actions.patchTask(id, { status: to });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid h-full grid-cols-5 gap-3 p-4">
        {COLS.map((c) => (
          <Column key={c.id} col={c} tasks={tasks.filter((t) => t.status === c.id).sort((a, b) => PRANK[a.priority] - PRANK[b.priority] || b.updatedAt - a.updatedAt)} />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ col, tasks }: { col: (typeof COLS)[number]; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-col rounded-xl border bg-deep/40 transition-colors ${isOver ? "border-arc/60 bg-arc/[0.04]" : "border-line/70"}`}
      style={{ boxShadow: `inset 0 2px 0 ${col.color}55` }}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="label" style={{ color: col.color }}>{col.label}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-ink-3">{tasks.length}</span>
          {(col.id === "backlog" || col.id === "todo") && (
            <button className="text-ink-3 hover:text-arc" onClick={() => setAdding((v) => !v)} aria-label="Add task"><Plus size={13} /></button>
          )}
        </div>
      </div>
      {adding && (
        <form
          className="px-2 pb-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            await actions.createTask({ title: title.trim() });
            setTitle("");
            setAdding(false);
          }}
        >
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title…" className="w-full rounded-md border border-line-2 bg-void/60 px-2 py-1.5 text-[12px] outline-none focus:border-arc/60" />
        </form>
      )}
      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const agents = useAgentMap();
  const set = useUI((s) => s.set);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const agent = task.agentId ? agents[task.agentId] : null;
  const live = agent?.status === "running" && agent.currentTaskId === task.id;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => set({ openTaskId: task.id })}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, zIndex: isDragging ? 50 : undefined }}
      className={`card cursor-grab p-2.5 active:cursor-grabbing ${isDragging ? "opacity-80 shadow-2xl ring-1 ring-arc/50" : ""} ${live ? "scanbar" : ""}`}
    >
      <div className="text-[12.5px] leading-snug text-ink">{task.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityChip p={task.priority} />
        <AgentChip agent={agent} />
        {task.ask && !task.ask.answer && <span className="chip !border-rose/50 !text-rose">needs you</span>}
        <span className="ml-auto font-mono text-[10px] text-ink-3">{ago(task.updatedAt)}</span>
      </div>
    </div>
  );
}
