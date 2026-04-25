"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAgentStore } from "@/lib/store";
import {
  buildSnapshot,
  estimateTokens,
} from "@/lib/agent/snapshot";
import { cn } from "@/lib/cn";

/**
 * Dev-only overlay that shows the agent's-eye view of the canvas in
 * real time. Press `Cmd/Ctrl + Shift + S` to toggle.
 *
 * This is the proof that the text-vector representation plan works:
 * everything the agent will receive is visible here, including the
 * 12×8 ASCII grid, per-window summaries, mount-point labels, and the
 * recent-action ring buffer. No screenshots, no DOM scraping.
 */
export function SnapshotInspector() {
  const [open, setOpen] = useState(false);
  // Trigger a re-render whenever any of these slices changes.
  const windows = useAgentStore((s) => s.windows);
  const recentActions = useAgentStore((s) => s.recentActions);
  const lastQuery = useAgentStore((s) => s.lastQuery);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed left-3 top-3 z-[55]",
          "h-6 rounded-sm border border-rule px-2",
          "font-mono text-[10px] uppercase tracking-wider text-ink-35",
          "bg-paper-1/85 backdrop-blur",
          "hover:text-ink-90 hover:bg-paper-2",
        )}
        aria-label="open agent snapshot inspector (cmd+shift+s)"
        title="agent snapshot — what the agent sees (⌘⇧S)"
      >
        agent · snapshot
      </button>
    );
  }

  // Recompute on every render — we depend on `windows` & friends above
  // so the closure refreshes whenever the canvas mutates.
  void windows;
  void recentActions;
  void lastQuery;
  const snap = buildSnapshot();
  const tokens = estimateTokens(snap);
  const tokenBudget = 350;
  const overBudget = tokens > tokenBudget;

  // We strip `grid` from the JSON pane so it renders side-by-side as
  // a monospace block instead of inline string with literal `\n`.
  const { grid: _grid, ...jsonish } = snap;
  void _grid;

  return (
    <AnimatePresence>
      <motion.aside
        key="snapshot-inspector"
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ duration: 0.12 }}
        className={cn(
          "fixed left-3 top-3 z-[55]",
          "w-[420px] max-h-[calc(100vh-24px)] overflow-hidden",
          "rounded-md border border-rule bg-paper-1/95 backdrop-blur",
          "shadow-[0_10px_40px_-15px_rgba(0,0,0,0.25)]",
          "flex flex-col",
        )}
      >
        <header className="flex items-center justify-between border-b border-rule px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-60">
            agent · snapshot
          </span>
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5",
                overBudget
                  ? "bg-red-500/10 text-red-600"
                  : "bg-paper-2 text-ink-60",
              )}
              title="estimated tokens vs 350-token budget"
            >
              ~{tokens}t / {tokenBudget}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-ink-35 hover:text-ink-90"
              aria-label="close"
            >
              esc
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto muji-scroll px-3 py-3 space-y-3 text-[11px] leading-relaxed">
          <Section label="grid (12×8)">
            <pre className="font-mono text-[10px] text-ink-90 whitespace-pre">
              {snap.grid}
            </pre>
          </Section>

          <Section label={`windows (${snap.windows.length})`}>
            {snap.windows.length === 0 ? (
              <p className="font-mono text-ink-35">no windows open</p>
            ) : (
              <ul className="space-y-1.5">
                {snap.windows.map((w) => (
                  <li key={w.id} className="font-mono text-[10.5px]">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          "shrink-0",
                          w.focused ? "text-accent-indigo" : "text-ink-60",
                        )}
                      >
                        {w.kind}
                      </span>
                      <span className="text-ink-35">·</span>
                      <span className="text-ink-60">{w.mount}</span>
                      <span className="text-ink-35">·</span>
                      <span className="text-ink-35">
                        {w.rect.x.toFixed(0)},{w.rect.y.toFixed(0)}{" "}
                        {w.rect.w.toFixed(0)}×{w.rect.h.toFixed(0)}%
                      </span>
                    </div>
                    {w.summary && (
                      <div className="pl-1 text-ink-60">↳ {w.summary}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section label={`recent actions (${snap.recentActions.length}/6)`}>
            {snap.recentActions.length === 0 ? (
              <p className="font-mono text-ink-35">no actions yet</p>
            ) : (
              <ul className="space-y-0.5">
                {snap.recentActions.map((a, i) => (
                  <li
                    key={`${a.tool}-${i}`}
                    className="font-mono text-[10.5px] text-ink-60"
                  >
                    <span className="text-ink-35">−{Math.round(a.t)}ms</span>{" "}
                    <span className={a.ok ? "text-ink-90" : "text-red-600"}>
                      {a.tool}
                    </span>{" "}
                    <span className="text-ink-35">
                      {JSON.stringify(a.args)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section label="json">
            <pre className="font-mono text-[10px] text-ink-60 whitespace-pre-wrap break-all">
              {JSON.stringify(jsonish, null, 2)}
            </pre>
          </Section>
        </div>

        <footer className="border-t border-rule px-3 py-1.5 font-mono text-[10px] text-ink-35">
          {`viewport ${snap.viewport.w}×${snap.viewport.h} · ⌘⇧S to toggle`}
        </footer>
      </motion.aside>
    </AnimatePresence>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-35 mb-1">
        {label}
      </h3>
      {children}
    </section>
  );
}
