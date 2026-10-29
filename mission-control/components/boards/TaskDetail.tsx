"use client";
import { AnimatePresence, motion } from "motion/react";
import { Trash2, X } from "lucide-react";
import type { Priority, TaskStatus } from "@/lib/types";
import { useMC, useAgentMap } from "@/lib/client/hooks";
import { useUI } from "@/lib/client/ui-store";
import { actions } from "@/lib/client/actions";
import { Markdown } from "@/components/Markdown";
import { AskCard } from "./AskCard";
import { ago } from "@/lib/client/format";

const STATUSES: TaskStatus[] = ["backlog", "todo", "doing", "review", "done"];
const PRIOS: Priority[] = ["p0", "p1", "p2", "p3"];
const sel = "rounded-md border border-line-2 bg-void/60 px-2 py-1 text-[12px] text-ink outline-none focus:border-arc/60";

export function TaskDetail() {
  const id = useUI((s) => s.openTaskId);
  const set = useUI((s) => s.set);
  const snap = useMC((s) => s.snapshot);
  const agents = useAgentMap();
  const task = id ? snap?.tasks.find((t) => t.id === id) : undefined;
  const arts = task ? (snap?.artifacts ?? []).filter((a) => task.artifactIds.includes(a.id) || a.taskId === task.id) : [];
  const close = () => set({ openTaskId: null });
  return (
    <AnimatePresence>
      {task && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div
            initial={{ y: 20, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 10, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="panel flex max-h-[85vh] w-[min(720px,100%)] flex-col"
          >
            <div className="flex items-start gap-3 border-b border-line p-5">
              <div className="min-w-0 flex-1">
                <div className="label mb-1">Task · updated {ago(task.updatedAt)}</div>
                <div className="text-lg font-semibold leading-snug">{task.title}</div>
              </div>
              <button className="btn !p-1.5" onClick={close} aria-label="Close"><X size={14} /></button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
              <select className={sel} value={task.status} onChange={(e) => actions.patchTask(task.id, { status: e.target.value as TaskStatus })}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select className={sel} value={task.priority} onChange={(e) => actions.patchTask(task.id, { priority: e.target.value as Priority })}>
                {PRIOS.map((p) => <option key={p}>{p}</option>)}
              </select>
              <select className={sel} value={task.agentId ?? ""} onChange={(e) => actions.patchTask(task.id, { agentId: e.target.value || null })}>
                <option value="">unassigned</option>
                {Object.values(agents).filter((a) => a.id !== "shepherd").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {task.agentId && task.status !== "doing" && task.status !== "done" && (
                <button className="btn btn-arc" onClick={() => actions.patchTask(task.id, { status: "doing" })}>Run now</button>
              )}
              <button className="btn ml-auto hover:!border-rose/60 hover:!text-rose" onClick={async () => { await actions.deleteTask(task.id); close(); }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {task.description && <Markdown text={task.description} />}
              {task.ask && !task.ask.answer && <AskCard task={task} />}
              {task.ask?.answer && (
                <div className="text-[12px] text-ink-3">You answered <span className="text-ink-2">“{task.ask.answer}”</span> to: {task.ask.question}</div>
              )}
              {task.result && (
                <div>
                  <div className="label mb-1.5">Result</div>
                  <Markdown text={task.result} />
                </div>
              )}
              {arts.map((a) => (
                <div key={a.id} className="rounded-lg border border-line bg-deep/50 p-4">
                  <div className="label mb-1">Artifact</div>
                  <div className="mb-2 text-[14px] font-semibold">{a.title}</div>
                  <Markdown text={a.content} />
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
