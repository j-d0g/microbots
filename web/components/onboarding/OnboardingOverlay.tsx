"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "microbots.onboarded.v2";

/* Three calm panes:
 *   1. cold-open    — wordmark + the product premise
 *   2. interactions — `.` to talk and `/` to type, both with kbd glyphs
 *   3. stage        — explains the centre-stage / sideline layout
 *
 * Pane changes are vertical wipes (paper-on-paper) per the design spec.
 * The user can advance with → / Enter, leave with Esc / "skip", and
 * the dismissal persists in localStorage so we don't show it again.
 */
export function OnboardingOverlay() {
  const [step, setStep] = useState<number>(0);
  const [visible, setVisible] = useState<boolean>(false);

  /* Decide on mount whether to show. localStorage is browser-only. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      setVisible(seen !== "true");
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        /* ignore — storage might be disabled */
      }
    }
  }, []);

  const next = useCallback(() => {
    setStep((s) => {
      if (s + 1 >= STEPS.length) {
        dismiss();
        return s;
      }
      return s + 1;
    });
  }, [dismiss]);

  const back = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  /* Keyboard navigation. We listen at window level because there's no
     focus inside the overlay's DOM by default. */
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, dismiss, next, back]);

  if (!visible) return null;

  const stepDef = STEPS[step];

  return (
    <AnimatePresence>
      <motion.div
        key="onboarding"
        data-testid="onboarding-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        className={cn(
          "fixed inset-0 z-[80] flex flex-col items-center justify-center",
          "bg-paper-0/97 backdrop-blur-sm",
        )}
      >
        {/* Wordmark, persistent across steps for continuity */}
        <motion.div
          layout
          className="absolute left-1/2 top-12 -translate-x-1/2 flex flex-col items-center"
        >
          <span
            className="font-mono text-[10px] uppercase tracking-[0.20em] text-ink-35"
            data-testid="onboarding-wordmark"
          >
            microbots
          </span>
        </motion.div>

        {/* Pane content with paper-over-paper vertical wipe */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex max-w-[560px] flex-col items-center px-6 text-center"
          >
            {stepDef.kind === "cold" && <ColdOpen />}
            {stepDef.kind === "interactions" && <Interactions />}
            {stepDef.kind === "stage" && <StagePrinciple />}
          </motion.div>
        </AnimatePresence>

        {/* Step pips + nav, fixed near the bottom */}
        <div className="absolute inset-x-0 bottom-12 flex flex-col items-center gap-5">
          <div className="flex items-center gap-1.5" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all duration-200",
                  i === step ? "w-6 bg-ink-90" : "w-1.5 bg-ink-35/60",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={back}
              disabled={step === 0}
              className={cn(
                "font-mono text-[11px] uppercase tracking-wider",
                "text-ink-35 hover:text-ink-60 transition-colors",
                "disabled:opacity-30 disabled:hover:text-ink-35",
              )}
              data-testid="onboarding-back"
            >
              ← back
            </button>
            <button
              type="button"
              onClick={next}
              data-testid="onboarding-next"
              className={cn(
                "rounded-md border border-ink-90 bg-ink-90 px-4 py-1.5",
                "font-mono text-[11px] uppercase tracking-[0.10em] text-paper-0",
                "hover:bg-ink-90/90 transition-colors",
              )}
            >
              {step === STEPS.length - 1 ? "begin" : "next"}{" "}
              <span aria-hidden>→</span>
            </button>
            <button
              type="button"
              onClick={dismiss}
              className={cn(
                "font-mono text-[11px] uppercase tracking-wider",
                "text-ink-35 hover:text-ink-60 transition-colors",
              )}
              /* `skip-onboarding` keeps backward compat with the
                 graph-shots / voice-dock-shots harnesses that already
                 dismiss the previous onboarding by that name. */
              data-testid="skip-onboarding"
            >
              skip
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Step content                                                        */
/* ------------------------------------------------------------------ */

interface StepDef {
  kind: "cold" | "interactions" | "stage";
}

const STEPS: StepDef[] = [
  { kind: "cold" },
  { kind: "interactions" },
  { kind: "stage" },
];

function ColdOpen() {
  return (
    <>
      <span
        aria-hidden
        className="block h-3 w-3 rounded-full bg-accent-indigo breathing"
      />
      <h1 className="mt-10 text-[34px] font-medium leading-[1.05] tracking-tight text-ink-90">
        the agent runs
        <br />
        the desk for you.
      </h1>
      <p className="mt-5 max-w-[460px] text-[15px] leading-relaxed text-ink-60">
        microbots reads your overnight signal, drafts the automations
        worth approving, and writes the python that runs them. you wake
        up to a desk it has already arranged.
      </p>
    </>
  );
}

function Interactions() {
  return (
    <>
      <h2 className="text-[28px] font-medium leading-[1.1] tracking-tight text-ink-90">
        two ways in.
      </h2>
      <p className="mt-3 max-w-[440px] text-[15px] leading-relaxed text-ink-60">
        no menus, no clicking around. you talk to the agent and it
        opens what it needs.
      </p>

      <div className="mt-10 grid w-full grid-cols-2 gap-6 text-left">
        <div className="rounded-xl border border-rule p-5">
          <Kbd>/</Kbd>
          <p className="mt-3 text-[13px] leading-snug text-ink-90">
            press to type a request. the bar lifts to the centre, the
            agent answers in the same place.
          </p>
        </div>
        <div className="rounded-xl border border-rule p-5">
          <Kbd>.</Kbd>
          <p className="mt-3 text-[13px] leading-snug text-ink-90">
            hold to talk. release when you're done — we keep listening
            for a beat to catch trailing words. uses your voice keys
            if you set them, browser fallback if you don't.
          </p>
        </div>
      </div>
    </>
  );
}

function StagePrinciple() {
  return (
    <>
      <h2 className="text-[28px] font-medium leading-[1.1] tracking-tight text-ink-90">
        one focal idea at a time.
      </h2>
      <p className="mt-3 max-w-[460px] text-[15px] leading-relaxed text-ink-60">
        the agent puts what you're working on at centre stage. older
        windows step aside as live thumbnails — tap one to bring it
        forward, or let the agent decide.
      </p>

      <StageDiagram />

      <p className="mt-6 max-w-[420px] font-mono text-[10px] uppercase tracking-wider text-ink-35">
        no chat history. memory carries the thread.
      </p>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md",
        "border border-rule bg-paper-1 px-2",
        "font-mono text-[14px] text-ink-90",
        "shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]",
      )}
    >
      {children}
    </span>
  );
}

function StageDiagram() {
  return (
    <div
      aria-hidden
      className="mt-8 flex h-[140px] w-full items-stretch gap-3"
    >
      <div className="flex w-1/5 flex-col gap-2">
        <div className="flex-1 rounded-md border border-rule bg-paper-1/80" />
        <div className="flex-1 rounded-md border border-rule bg-paper-1/60" />
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <div className="absolute inset-0 rounded-xl border border-rule bg-paper-0 shadow-[0_2px_4px_rgba(0,0,0,0.03),0_18px_44px_-22px_rgba(0,0,0,0.30)]" />
        <span className="relative font-mono text-[10px] uppercase tracking-[0.10em] text-ink-60">
          centre stage
        </span>
      </div>
      <div className="flex w-1/5 flex-col gap-2">
        <div className="flex-1 rounded-md border border-rule bg-paper-1/80" />
        <div className="flex-1 rounded-md border border-rule bg-paper-1/60" />
        <div className="flex-1 rounded-md border border-rule bg-paper-1/40" />
      </div>
    </div>
  );
}
