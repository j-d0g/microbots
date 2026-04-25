"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { RoomKind, RoomState } from "@/lib/store";

const STATE_COPY: Record<RoomState, { label: string; detail: string }> = {
  ready: { label: "", detail: "" },
  loading: { label: "loading", detail: "pulling the latest from your integrations..." },
  empty: { label: "empty", detail: "nothing here yet. connect an integration or tell me about your day." },
  error: { label: "error", detail: "something went wrong. I will retry shortly." },
  thinking: { label: "thinking", detail: "working on it..." },
  speaking: { label: "speaking", detail: "" },
  deploying: { label: "deploying", detail: "spinning up the service in shadow mode..." },
  "approval-success": { label: "approved", detail: "queued for shadow deploy. I will promote after one clean cycle." },
};

export function RoomStateOverlay({
  room,
  state,
  children,
}: {
  room: RoomKind;
  state?: RoomState;
  children: React.ReactNode;
}) {
  const showOverlay = state && state !== "ready";

  return (
    <div
      className="relative h-full w-full"
      data-testid={`room-${room}`}
      data-room-state={state ?? "ready"}
    >
      {children}
      <AnimatePresence>
        {showOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-paper-0/80 backdrop-blur-[2px]"
            data-testid={`room-state-${state}`}
          >
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
              {STATE_COPY[state].label}
            </p>
            {state === "loading" || state === "thinking" ? (
              <div className="mt-4 h-3 w-3 rounded-full bg-accent-indigo breathing" />
            ) : null}
            {STATE_COPY[state].detail && (
              <p className="mt-3 max-w-[400px] text-center text-[15px] leading-relaxed text-ink-60">
                {STATE_COPY[state].detail}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
