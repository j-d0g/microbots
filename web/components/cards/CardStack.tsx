"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function CardStack() {
  const cards = useAgentStore((s) => s.cards);
  const dismiss = useAgentStore((s) => s.dismissCard);

  return (
    <div
      aria-live="polite"
      className="fixed bottom-28 right-6 z-40 flex flex-col gap-3 max-w-[360px]"
    >
      <AnimatePresence>
        {cards.map((card) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn(
              "rounded-md border border-rule bg-paper-1 p-3",
              "text-sm text-ink-90",
              "shadow-[0_1px_0_rgba(0,0,0,0.04)]",
            )}
            onClick={() => dismiss(card.id)}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
                {card.kind}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(card.id);
                }}
                className="text-ink-35 hover:text-ink-60 text-xs"
              >
                dismiss
              </button>
            </div>
            <CardBody data={card.data} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function CardBody({ data }: { data: Record<string, unknown> }) {
  const text = typeof data.text === "string" ? data.text : "";
  const confidence =
    typeof data.confidence === "number" ? data.confidence : undefined;
  return (
    <div>
      {text && <p className="leading-relaxed">{text}</p>}
      {confidence !== undefined && (
        <p className="mt-1 font-mono text-[10px] text-ink-35">
          confidence {confidence.toFixed(2)}
        </p>
      )}
    </div>
  );
}
