"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  computeStageLayout,
  stageLayoutToRects,
  type StageRect,
} from "@/lib/stage-manager";
import { useAgentStore, type WindowState, type WindowKind } from "@/lib/store";
import { CentreFrame } from "./CentreFrame";
import { SidelinePanel } from "./SidelinePanel";
import { GraphRoom } from "@/components/rooms/GraphRoom";
import { SettingsRoom } from "@/components/rooms/SettingsRoom";
import { RunCodeWindow } from "@/components/windows/RunCodeWindow";
import { SaveWorkflowWindow } from "@/components/windows/SaveWorkflowWindow";
import { ViewWorkflowWindow } from "@/components/windows/ViewWorkflowWindow";
import { RunWorkflowWindow } from "@/components/windows/RunWorkflowWindow";
import { ListWorkflowsWindow } from "@/components/windows/ListWorkflowsWindow";
import { FindExamplesWindow } from "@/components/windows/FindExamplesWindow";
import { SearchMemoryWindow } from "@/components/windows/SearchMemoryWindow";
import { AskUserCard } from "@/components/windows/AskUserCard";

const ROOM_COMPONENTS: Record<
  WindowKind,
  React.ComponentType<{ payload?: Record<string, unknown> }>
> = {
  run_code: RunCodeWindow,
  save_workflow: SaveWorkflowWindow,
  view_workflow: ViewWorkflowWindow,
  run_workflow: RunWorkflowWindow,
  list_workflows: ListWorkflowsWindow,
  find_examples: FindExamplesWindow,
  search_memory: SearchMemoryWindow,
  ask_user: AskUserCard,
  graph: GraphRoom,
  settings: SettingsRoom,
};

const SPRING = {
  type: "spring" as const,
  stiffness: 280,
  damping: 30,
  mass: 0.7,
};

/**
 * Stage-manager driven renderer.
 *
 * Pulls the open window set from the store, hands it to
 * `computeStageLayout` (the pure layout engine in lib/stage-manager.ts
 * the windows agent owns) and renders each window at its computed
 * stage rect with a presentation that matches its role:
 *
 *   centre   → full chrome, focal sizing, interactive room
 *   sideline → small thumbnail with live preview, click to promote
 *   backdrop → graph room at 8% opacity, full-bleed atmosphere
 *   modal    → ask_user, centred prominently above everything
 *
 * The agent's tool calls (open_window, bring_to_front, etc) feed the
 * store; this component is purely the visual layer that turns that
 * state into a calm Stage Manager view.
 */
export function StageDesktop() {
  const windows = useAgentStore((s) => s.windows);
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() =>
    typeof window !== "undefined"
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 1440, h: 900 },
  );

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const visible = useMemo(() => windows.filter((w) => !w.minimized), [windows]);

  /* The window with the highest zIndex is the active one — that's
     what the store's `bringToFront` increments, and what we want to
     promote to centre stage. */
  const activeId = useMemo(() => {
    if (visible.length === 0) return null;
    let best = visible[0];
    for (const w of visible) if (w.zIndex > best.zIndex) best = w;
    return best.id;
  }, [visible]);

  const layout = useMemo(
    () =>
      computeStageLayout(
        visible.map((w) => ({
          id: w.id,
          kind: w.kind,
          zIndex: w.zIndex,
          pinned: w.pinned,
          openedAt: w.openedAt,
        })),
        activeId,
      ),
    [visible, activeId],
  );

  const rects = useMemo(
    () => stageLayoutToRects(layout, viewport),
    [layout, viewport],
  );

  const winById = useMemo(() => {
    const m = new Map<string, WindowState>();
    for (const w of visible) m.set(w.id, w);
    return m;
  }, [visible]);

  /* Empty state: a calm prompt invites the user to type or talk. */
  if (visible.length === 0) {
    return (
      <div
        className="fixed inset-0 flex items-end justify-center pb-[180px] pointer-events-none"
        data-testid="stage-empty"
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 0.6, y: 0 }}
          transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          className="font-mono text-[11px] uppercase tracking-[0.10em] text-ink-35"
        >
          press <span className="text-ink-90">/</span> to type ·
          hold <span className="text-ink-90">.</span> to talk
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      data-testid="stage-desktop"
    >
      {/* Backdrop graph at 8% opacity */}
      {layout.graphBackdrop && (
        <BackdropGraph viewport={viewport} graphWindow={findGraph(visible)} />
      )}

      <AnimatePresence mode="popLayout">
        {/* Sidelines: render under centre */}
        {layout.leftSidelineIds.map((id) => {
          const win = winById.get(id);
          const r = rects.get(id);
          if (!win || !r) return null;
          return (
            <SidelineSlot key={id} win={win} rect={r} side="left" />
          );
        })}
        {layout.rightSidelineIds.map((id) => {
          const win = winById.get(id);
          const r = rects.get(id);
          if (!win || !r) return null;
          return (
            <SidelineSlot key={id} win={win} rect={r} side="right" />
          );
        })}

        {/* Centre stage: 1–4 windows in the focal slot */}
        {layout.centreIds.map((id) => {
          const win = winById.get(id);
          const r = rects.get(id);
          if (!win || !r) return null;
          const Room = ROOM_COMPONENTS[win.kind];
          const isFocused = id === activeId;
          return (
            <motion.div
              key={id}
              data-testid={`stage-slot-${win.kind}`}
              layout
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{
                opacity: r.opacity,
                scale: 1,
                y: 0,
                x: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
              }}
              exit={{ opacity: 0, scale: 0.94, y: 8 }}
              transition={SPRING}
              style={{ position: "absolute", left: 0, zIndex: r.zIndex }}
            >
              <CentreFrame win={win} isFocused={isFocused}>
                <Room payload={win.payload} />
              </CentreFrame>
            </motion.div>
          );
        })}

        {/* Modal layer (ask_user) */}
        {layout.modalId &&
          (() => {
            const win = winById.get(layout.modalId);
            const r = rects.get(layout.modalId);
            if (!win || !r) return null;
            const Room = ROOM_COMPONENTS[win.kind];
            return (
              <motion.div
                key={layout.modalId}
                data-testid="stage-modal"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, x: r.x, top: r.y, width: r.w, height: r.h }}
                exit={{ opacity: 0, y: 12 }}
                transition={SPRING}
                style={{ position: "absolute", left: 0, zIndex: r.zIndex }}
              >
                <CentreFrame win={win} isFocused>
                  <Room payload={win.payload} />
                </CentreFrame>
              </motion.div>
            );
          })()}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function SidelineSlot({
  win,
  rect,
  side,
}: {
  win: WindowState;
  rect: StageRect;
  side: "left" | "right";
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: side === "left" ? -16 : 16 }}
      animate={{
        opacity: rect.opacity,
        x: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
      }}
      exit={{ opacity: 0, x: side === "left" ? -16 : 16 }}
      transition={SPRING}
      style={{ position: "absolute", left: 0, zIndex: rect.zIndex }}
    >
      <SidelinePanel win={win} side={side} />
    </motion.div>
  );
}

function BackdropGraph({
  viewport,
  graphWindow,
}: {
  viewport: { w: number; h: number };
  graphWindow: WindowState | null;
}) {
  if (!graphWindow) return null;
  /* The backdrop is the active graph rendered at the size of the
   * viewport, deeply faded. It sits beneath everything (z=1) and
   * absorbs no pointer events. We animate the opacity into 0.08 so
   * the entire graph reads as atmosphere, not as content. */
  return (
    <motion.div
      key="backdrop-graph"
      data-testid="stage-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.08 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 1 }}
    >
      <div style={{ width: viewport.w, height: viewport.h }}>
        <GraphRoom payload={graphWindow.payload} />
      </div>
    </motion.div>
  );
}

function findGraph(windows: WindowState[]): WindowState | null {
  return windows.find((w) => w.kind === "graph") ?? null;
}
