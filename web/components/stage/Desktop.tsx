"use client";

import { useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAgentStore, type RoomKind, type WindowKind } from "@/lib/store";
import { WindowFrame } from "./WindowFrame";
import { ConfirmCardStack } from "./ConfirmCard";
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

const ROOM_COMPONENTS: Record<WindowKind, React.ComponentType<{ payload?: Record<string, unknown> }>> = {
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

const SPRING = { type: "spring", stiffness: 400, damping: 32, mass: 0.8 } as const;

export function Desktop() {
  const windows = useAgentStore((s) => s.windows);
  const closeTopWindow = useAgentStore((s) => s.closeTopWindow);
  const openWindow = useAgentStore((s) => s.openWindow);
  const arrangeWindows = useAgentStore((s) => s.arrangeWindows);
  const updateWindowRect = useAgentStore((s) => s.updateWindowRect);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeTopWindow();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const rooms: WindowKind[] = [
          "run_code", "graph", "list_workflows", "search_memory",
          "find_examples", "settings",
        ];
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < rooms.length) {
          e.preventDefault();
          openWindow(rooms[idx]);
        }
        if (e.key === "g") {
          e.preventDefault();
          arrangeWindows("grid");
        }
      }
    },
    [closeTopWindow, openWindow, arrangeWindows],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Re-clamp every window on browser-resize so stale rects (set when
  // the viewport was larger) don't keep clipping. updateWindowRect
  // already runs through clampToBounds, so passing the current rect
  // through it is enough — if the window now overflows, it shrinks /
  // shifts back into bounds; otherwise it's a no-op.
  //
  // Debounced via rAF to coalesce rapid resize ticks. We grab the
  // latest rect off the store inside the handler so we don't capture
  // a stale `windows` snapshot.
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const live = useAgentStore.getState().windows;
        for (const w of live) updateWindowRect(w.id, w.rect);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [updateWindowRect]);

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      data-testid="desktop-canvas"
    >
      <AnimatePresence mode="popLayout">
        {windows
          .filter((w) => !w.minimized)
          .map((win) => {
            const Room = ROOM_COMPONENTS[win.kind];
            return (
              <motion.div
                key={win.id}
                initial={{ opacity: 0, scale: 0.92, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={SPRING}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                }}
              >
                <div style={{ pointerEvents: "auto" }}>
                  <WindowFrame win={win}>
                    <Room payload={win.payload} />
                  </WindowFrame>
                </div>
              </motion.div>
            );
          })}
      </AnimatePresence>
      <ConfirmCardStack />
    </div>
  );
}
