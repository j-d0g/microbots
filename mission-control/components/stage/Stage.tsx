"use client";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { useMC } from "@/lib/client/hooks";
import { WidgetView } from "./Widget";
import { actions } from "@/lib/client/actions";

const WIDE = new Set(["chart", "timeline", "markdown", "decision"]);
const STARTERS = ["What should I work on today?", "Research the Pi agent harness", "Draft my weekly update", "Show me the team"];

export function Stage() {
  const widgets = useMC((s) => s.snapshot?.stage.widgets ?? []);
  if (!widgets.length)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <Sparkles className="text-arc/70" size={28} />
        <div className="text-sm text-ink-2">The stage is clear. Ask the shepherd something.</div>
        <div className="flex flex-wrap justify-center gap-2">
          {STARTERS.map((s) => (
            <button key={s} className="btn" onClick={() => actions.command(s)}>{s}</button>
          ))}
        </div>
      </div>
    );
  return (
    <div className="grid auto-rows-min grid-cols-1 gap-3 p-4 xl:grid-cols-2">
      <AnimatePresence initial={false} mode="popLayout">
        {[...widgets].reverse().map((sw, i) => (
          <motion.div
            key={sw.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.97, filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1], delay: i * 0.05 }}
            className={`relative overflow-hidden rounded-xl border border-line bg-panel/70 p-4 ${WIDE.has(sw.widget.kind) ? "xl:col-span-2" : ""}`}
          >
            {i === 0 && <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-arc to-transparent" />}
            <WidgetView w={sw.widget} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
