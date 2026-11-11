"use client";
import { useState } from "react";
import type { Task } from "@/lib/types";
import { actions } from "@/lib/client/actions";

export function AskCard({ task, compact }: { task: Task; compact?: boolean }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  if (!task.ask || task.ask.answer) return null;
  const send = async (a: string) => {
    if (!a.trim()) return;
    setSent(true);
    try {
      await actions.answer(task.id, a.trim());
    } catch {
      setSent(false);
    }
  };
  return (
    <div className={`rounded-lg border border-rose/40 bg-rose/[0.06] ${compact ? "p-2.5" : "p-3"}`}>
      <div className="label !text-rose/90 !text-[9.5px]">Needs you</div>
      <div className="mt-1 text-[13px] font-medium leading-snug text-ink">{task.ask.question}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {task.ask.options.map((o) => (
          <button key={o} disabled={sent} className="btn !py-1 !text-[11.5px] hover:!border-rose/60" onClick={() => send(o)}>
            {o}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          value={text}
          disabled={sent}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or type an answer…"
          className="min-w-0 flex-1 rounded-md border border-line bg-void/60 px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-rose/50"
        />
      </form>
      {sent && <div className="mt-1.5 font-mono text-[10.5px] text-ink-3">sent — resuming…</div>}
    </div>
  );
}
