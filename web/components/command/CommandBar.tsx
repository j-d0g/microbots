"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAgentStore } from "@/lib/store";
import { AgentFallback, applyAgentEvent, sendQuery } from "@/lib/agent-client";
import { routeIntent } from "@/lib/agent-router";
import { cn } from "@/lib/cn";

const SUGGESTIONS = [
  "morning",
  "show me the graph",
  "open the bug triage workflow",
  "list services",
  "draft the friday update",
  "explain the weekly cadence",
];

/**
 * Spotlight-style command bar.
 *
 * Three visual phases:
 *   - "spotlight" — open, before submission OR while typing again. Center
 *      of the screen. Dimmed backdrop with light blur. Suggestions below.
 *   - "streaming" — query in flight. Same spotlight position so the user
 *      can read live output. Backdrop dims more (blur stays light).
 *   - "tucked" — reply done. Bar slides down to just above the dock as
 *      a slim chip with the reply visible. Backdrop is gone so the user
 *      can see the canvas. Click the chip (or `/`) to morph back to
 *      spotlight.
 *
 * The morph between phases uses framer-motion's `layoutId` to animate
 * position, width, and corner radius in one continuous spring.
 */
export function CommandBar() {
  const open = useAgentStore((s) => s.commandOpen);
  const setOpen = useAgentStore((s) => s.setCommandOpen);
  const reply = useAgentStore((s) => s.agentReply);
  const lastQuery = useAgentStore((s) => s.lastQuery);
  const dock = useAgentStore((s) => s.dock);
  const uiMode = useAgentStore((s) => s.uiMode);
  const clearReply = useAgentStore((s) => s.clearReply);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** When true, even a finished reply renders in spotlight position
   *  (because the user is editing/about-to-resubmit). Cleared on
   *  successful query, so the next reply.done re-tucks. */
  const [forceSpotlight, setForceSpotlight] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* derive phase ----------------------------------------------------- */
  const phase: "spotlight" | "tucked" = useMemo(() => {
    if (busy) return "spotlight";
    if (forceSpotlight) return "spotlight";
    // In windowed mode, FloatingDock shows the reply — don't duplicate with tucked chip
    if (uiMode === "windowed") return "spotlight";
    // After reply.done, we tuck if there is anything to summarise.
    if (reply.length > 0 && lastQuery) return "tucked";
    return "spotlight";
  }, [busy, forceSpotlight, reply, lastQuery, uiMode]);

  /* shortcut: `/` opens; Esc closes --------------------------------- */
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable === true;

      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        if (!open) setOpen(true);
        // Focus input + lift to spotlight even if we were tucked.
        setForceSpotlight(true);
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* autofocus on open + reset on close ------------------------------ */
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setInput("");
      setBusy(false);
      setForceSpotlight(false);
    }
  }, [open]);

  /* clear forceSpotlight whenever we move into busy/streaming ------- */
  useEffect(() => {
    if (busy) setForceSpotlight(false);
  }, [busy]);

  /* In windowed mode, auto-dismiss once the agent finishes so the
   * FloatingDock takes over and the user sees the canvas behind.
   * Fires on every busy→idle transition (not gated on reply length —
   * tool-only responses and fallbacks should also dismiss). The reply
   * text, if any, persists in the store so the dock still shows it. */
  const prevBusyRef = useRef(false);
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (wasBusy && !busy && uiMode === "windowed") {
      // Short delay so the user sees the final text land before
      // the spotlight animates away.
      const t = window.setTimeout(() => {
        setOpen(false);
        // Don't clearReply — the dock reads agentReply from the store.
      }, 350);
      return () => window.clearTimeout(t);
    }
  }, [busy, uiMode, setOpen]);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    setOpen(false);
    clearReply();
  }, [setOpen, clearReply]);

  const submitQuery = useCallback(
    async (q: string) => {
      if (!q || busy) return;
      setBusy(true);
      setForceSpotlight(false);
      // Record the user's input in chatMessages so the chat window
      // (and any other transcript surface) sees it immediately.
      // agent-client's reply.start dedupes against the same text on
      // the trailing message, so this doesn't double-push.
      useAgentStore.getState().appendChatMessage({
        id: `user-${Date.now()}`,
        role: "user",
        text: q,
        ts: Date.now(),
        room: useAgentStore.getState().chatRoom,
      });
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await sendQuery(q, ctrl.signal);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof AgentFallback) {
          for await (const evt of routeIntent(q)) {
            if (ctrl.signal.aborted) break;
            applyAgentEvent(evt);
          }
        } else {
          // eslint-disable-next-line no-console
          console.error("[command-bar] sendQuery failed:", err);
        }
      } finally {
        setBusy(false);
        setInput("");
      }
    },
    [busy],
  );

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      submitQuery(input.trim());
    },
    [input, submitQuery],
  );

  const handleInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  /** Tap the tucked chip → re-enter spotlight without losing the reply. */
  const expandToSpotlight = useCallback(() => {
    setForceSpotlight(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const showResponse = busy || reply.length > 0 || lastQuery !== "";

  if (!open) return null;

  return (
    <>
      {/* Backdrop. Visible only in spotlight. Click to close. */}
      <AnimatePresence>
        {phase === "spotlight" && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={handleClose}
            aria-hidden
            className="fixed inset-0 z-[55] bg-paper-0/30 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      {/* Bar. Two render branches share `layoutId` so framer-motion
          animates the morph (position, size, corner radius). */}
      <AnimatePresence mode="popLayout">
        {phase === "spotlight" ? (
          <motion.div
            key="spotlight-shell"
            className="fixed inset-x-0 top-[18vh] z-[60] flex justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              layoutId="agent-bar"
              role="dialog"
              aria-label="agent command bar"
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "pointer-events-auto relative w-[min(640px,92vw)] overflow-hidden rounded-xl",
                "bg-paper-1/95 backdrop-blur-xl",
                "border border-rule",
                "shadow-[0_24px_60px_-20px_rgba(0,0,0,0.25),0_2px_0_rgba(0,0,0,0.04)]",
              )}
            >
              <form onSubmit={handleSubmit} className="px-5 pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <motion.span
                    layoutId="agent-bar-pulse"
                    aria-hidden
                    className={cn(
                      "block h-2 w-2 rounded-full",
                      busy ? "bg-accent-indigo breathing" : "bg-ink-90",
                    )}
                  />
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleInputKey}
                    placeholder="ask the agent…"
                    disabled={busy}
                    className={cn(
                      "flex-1 bg-transparent outline-none",
                      "text-[18px] leading-snug tracking-tight text-ink-90",
                      "placeholder:text-ink-35",
                      "disabled:opacity-50",
                    )}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <kbd className="hidden sm:inline-flex h-6 items-center rounded-sm border border-rule px-2 font-mono text-[10px] text-ink-35">
                    esc
                  </kbd>
                </div>
              </form>

              <AnimatePresence initial={false}>
                {showResponse ? (
                  <motion.div
                    key="response"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                    className="overflow-hidden border-t border-rule"
                  >
                    <div className="px-5 py-4">
                      {lastQuery && (
                        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
                          you · {lastQuery}
                        </p>
                      )}
                      <p
                        className={cn(
                          "mt-2 text-[15px] leading-relaxed text-ink-90",
                          busy && reply.length === 0 && "text-ink-35",
                        )}
                      >
                        {reply.length > 0
                          ? reply
                          : busy
                            ? dockLabel(dock)
                            : ""}
                        {busy && reply.length > 0 && (
                          <span
                            aria-hidden
                            className="ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] bg-accent-indigo breathing"
                          />
                        )}
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="suggestions"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-t border-rule px-5 py-3"
                  >
                    <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
                      try
                    </p>
                    <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {SUGGESTIONS.map((s) => (
                        <li key={s}>
                          <button
                            type="button"
                            onClick={() => {
                              setInput(s);
                              submitQuery(s);
                            }}
                            className="text-left font-mono text-[12px] text-ink-60 hover:text-ink-90 transition-colors"
                          >
                            / {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        ) : (
          /* tucked: slim chip just above the dock. Canvas visible. */
          <motion.div
            key="tucked-shell"
            className="fixed inset-x-0 bottom-[6rem] z-[60] flex justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.button
              layoutId="agent-bar"
              type="button"
              onClick={expandToSpotlight}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className={cn(
                "pointer-events-auto group relative flex items-center gap-3",
                "w-[min(560px,92vw)] rounded-full px-4 py-2.5 text-left",
                "bg-paper-1/90 backdrop-blur-xl",
                "border border-rule",
                "shadow-[0_12px_30px_-12px_rgba(0,0,0,0.20)]",
                "hover:bg-paper-1 transition-colors",
              )}
              aria-label="reopen command bar"
            >
              <motion.span
                layoutId="agent-bar-pulse"
                aria-hidden
                className="block h-2 w-2 shrink-0 rounded-full bg-ink-90"
              />
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                {lastQuery && (
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-35">
                    {lastQuery.length > 14
                      ? lastQuery.slice(0, 14) + "…"
                      : lastQuery}
                  </span>
                )}
                <span className="truncate text-[13px] leading-snug text-ink-90">
                  {reply || dockLabel(dock)}
                </span>
              </span>
              <kbd className="ml-auto hidden shrink-0 sm:inline-flex h-5 items-center rounded-sm border border-rule px-1.5 font-mono text-[10px] text-ink-35 group-hover:text-ink-60">
                /
              </kbd>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function dockLabel(state: ReturnType<typeof useAgentStore.getState>["dock"]) {
  switch (state) {
    case "thinking":
      return "thinking…";
    case "speaking":
      return "speaking…";
    case "listening":
      return "listening…";
    default:
      return "…";
  }
}
