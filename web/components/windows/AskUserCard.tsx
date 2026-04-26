"use client";

/**
 * ask_user card — compact modal focus card (not a standard window).
 *
 * Question text + options (<= 4 voice-labelled chips).
 * Voice & click both answer.
 * Four-phase lifecycle: posed -> listening -> resolving -> dismissed.
 * Backdrop dims canvas to 60%, indigo halo, backdrop-blur-md.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export function AskUserCard({ payload }: { payload?: Record<string, unknown> }) {
  const question = (payload?.question as string) ?? "What would you like to do?";
  const options = (payload?.options as string[]) ?? [];
  const onAnswer = payload?.onAnswer as ((answer: string) => void) | undefined;
  const [answered, setAnswered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (answer: string) => {
    setSelected(answer);
    setAnswered(true);
    onAnswer?.(answer);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "flex flex-col items-center justify-center p-6",
        "rounded-lg border border-accent-indigo/30",
        "bg-paper-1/95 backdrop-blur-md",
        "shadow-[0_0_0_1px_rgba(46,58,140,0.08),0_4px_24px_rgba(46,58,140,0.12)]",
      )}
    >
      {/* Question */}
      <p className="font-mono text-[13px] text-ink-90 text-center leading-relaxed mb-4 max-w-[400px]">
        {question}
      </p>

      {/* Options */}
      {options.length > 0 && !answered && (
        <div className="flex flex-wrap gap-2 justify-center">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => handleSelect(opt)}
              className={cn(
                "font-mono text-[11px] px-4 py-2 rounded-md",
                "border border-rule hover:border-accent-indigo/50",
                "bg-paper-2/80 hover:bg-accent-indigo-soft",
                "text-ink-60 hover:text-accent-indigo",
                "transition-all duration-150",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Answered state */}
      {answered && selected && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-confidence-high">
            answered:
          </span>
          <span className="font-mono text-[12px] text-ink-90">
            {selected}
          </span>
        </div>
      )}

      {/* Voice hint */}
      {!answered && options.length === 0 && (
        <p className="font-mono text-[10px] text-ink-35">
          speak your answer or type below
        </p>
      )}
    </motion.div>
  );
}
