"use client";

import { useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAgentStore, type RoomKind } from "@/lib/store";
import { WindowFrame } from "./WindowFrame";
import { BriefRoom } from "@/components/rooms/BriefRoom";
import { GraphRoom } from "@/components/rooms/GraphRoom";
import { WorkflowRoom } from "@/components/rooms/WorkflowRoom";
import { StackRoom } from "@/components/rooms/StackRoom";
import { WaffleRoom } from "@/components/rooms/WaffleRoom";
import { PlaybooksRoom } from "@/components/rooms/PlaybooksRoom";
import { SettingsRoom } from "@/components/rooms/SettingsRoom";

const ROOM_COMPONENTS: Record<RoomKind, React.ComponentType<{ payload?: Record<string, unknown> }>> = {
  brief: BriefRoom,
  graph: GraphRoom,
  workflow: WorkflowRoom,
  stack: StackRoom,
  waffle: WaffleRoom,
  playbooks: PlaybooksRoom,
  settings: SettingsRoom,
};

const SPRING = { type: "spring", stiffness: 400, damping: 32, mass: 0.8 } as const;

export function Desktop() {
  const windows = useAgentStore((s) => s.windows);
  const closeTopWindow = useAgentStore((s) => s.closeTopWindow);
  const openWindow = useAgentStore((s) => s.openWindow);
  const arrangeWindows = useAgentStore((s) => s.arrangeWindows);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeTopWindow();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const rooms: RoomKind[] = [
          "brief", "graph", "workflow", "stack", "waffle", "playbooks", "settings",
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
    </div>
  );
}
