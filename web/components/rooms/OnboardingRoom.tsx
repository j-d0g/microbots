"use client";

import { motion } from "framer-motion";
import { useAgentStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function OnboardingRoom() {
  const setOnboarded = useAgentStore((s) => s.setOnboarded);
  const openWindow = useAgentStore((s) => s.openWindow);

  const handleStart = () => {
    setOnboarded(true);
    // Open settings centered on the canvas during onboarding so the
    // user_id field is right where their attention is. After onboarding
    // it falls back to the registry's defaultMount (right-wide).
    if (typeof window !== "undefined") {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(720, Math.round(vw * 0.6));
      const h = Math.min(640, Math.round(vh * 0.7));
      openWindow("settings", {
        rect: {
          x: Math.round((vw - w) / 2),
          y: Math.round((vh - h) / 2),
          w,
          h,
        },
      });
    } else {
      openWindow("settings");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper-0">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex flex-col items-center text-center"
      >
        {/* breathing dot */}
        <button
          type="button"
          onClick={handleStart}
          className="group flex h-24 w-24 items-center justify-center rounded-full hover:bg-paper-1 transition-colors"
          data-testid="onboarding-dot"
        >
          <span
            className={cn(
              "block h-4 w-4 rounded-full bg-accent-indigo breathing",
            )}
          />
        </button>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="mt-8 max-w-[420px] text-[18px] leading-relaxed text-ink-60"
          data-testid="onboarding-hint"
        >
          press and hold the dot, then tell me about your day
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.6 }}
          className="mt-4 font-mono text-[11px] text-ink-35"
        >
          or press / to type
        </motion.p>

        <motion.button
          type="button"
          onClick={handleStart}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 0.6 }}
          className="mt-12 font-mono text-[11px] text-ink-35 underline-offset-4 hover:underline hover:text-ink-60 transition-colors"
          data-testid="skip-onboarding"
        >
          skip to settings &rarr;
        </motion.button>
      </motion.div>
    </div>
  );
}
