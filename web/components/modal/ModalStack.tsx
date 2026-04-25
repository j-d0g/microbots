"use client";

import { useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Maximize2 } from "lucide-react";
import { useAgentStore, type Modal, type RoomKind } from "@/lib/store";
import { cn } from "@/lib/cn";
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

const CORNER_POS: Record<string, { x: number; y: number }> = {
  "top-left": { x: 24, y: 24 },
  "top-right": { x: -24, y: 24 },
  "bottom-left": { x: 24, y: -24 },
  "bottom-right": { x: -24, y: -24 },
};

const EASE = [0.2, 0.8, 0.2, 1] as const;

function getCornerStyle(pos: Modal["position"]): React.CSSProperties {
  if (!pos) return { bottom: 120, right: 24 };
  if (typeof pos === "string") {
    const c = pos;
    const style: React.CSSProperties = {};
    if (c.includes("top")) style.top = 24;
    else style.bottom = 120;
    if (c.includes("left")) style.left = 24;
    else style.right = 24;
    return style;
  }
  return { left: pos.x, top: pos.y };
}

function snapToCorner(x: number, y: number): string {
  const midX = window.innerWidth / 2;
  const midY = window.innerHeight / 2;
  if (x < midX && y < midY) return "top-left";
  if (x >= midX && y < midY) return "top-right";
  if (x < midX && y >= midY) return "bottom-left";
  return "bottom-right";
}

export function ModalStack() {
  const modals = useAgentStore((s) => s.modals);
  const closeTopModal = useAgentStore((s) => s.closeTopModal);
  const closeModal = useAgentStore((s) => s.closeModal);
  const promoteModal = useAgentStore((s) => s.promoteModal);
  const updateModalPosition = useAgentStore((s) => s.updateModalPosition);
  const openRoom = useAgentStore((s) => s.openRoom);

  // Keyboard: Esc closes topmost, Ctrl+1..7 opens room
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeTopModal();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const rooms: RoomKind[] = [
          "brief", "graph", "workflow", "stack", "waffle", "playbooks", "settings",
        ];
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < rooms.length) {
          e.preventDefault();
          openRoom(rooms[idx]);
        }
      }
    },
    [closeTopModal, openRoom],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <AnimatePresence mode="popLayout">
      {modals.map((modal) => {
        const Room = ROOM_COMPONENTS[modal.kind];
        const isFullscreen = modal.display === "fullscreen";

        if (isFullscreen) {
          return (
            <motion.div
              key={modal.id}
              data-testid={`modal-${modal.kind}`}
              data-modal-display="fullscreen"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.24, ease: EASE }}
              className="fixed inset-0 z-10 overflow-y-auto bg-paper-0"
            >
              <div className="mx-auto max-w-[1040px] px-[72px] pb-40 pt-24">
                <Room payload={modal.payload} />
              </div>
            </motion.div>
          );
        }

        // PiP modal
        const cornerStyle = getCornerStyle(modal.position);
        return (
          <motion.div
            key={modal.id}
            data-testid={`modal-${modal.kind}`}
            data-modal-display="pip"
            drag
            dragMomentum={false}
            onDragEnd={(_e, info) => {
              const corner = snapToCorner(info.point.x, info.point.y) as "top-left" | "top-right" | "bottom-left" | "bottom-right";
              updateModalPosition(modal.id, corner);
            }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.24, ease: EASE }}
            style={{ ...cornerStyle, position: "fixed" }}
            className={cn(
              "z-20 h-[320px] w-[480px] overflow-hidden",
              "rounded-lg border border-rule bg-paper-1",
              "shadow-[0_1px_0_rgba(0,0,0,0.04)]",
              "cursor-grab active:cursor-grabbing",
            )}
          >
            <div className="flex h-8 items-center justify-end gap-1 px-2">
              <button
                type="button"
                onClick={() => promoteModal(modal.id)}
                className="flex h-6 w-6 items-center justify-center text-ink-35 hover:text-ink-60"
                aria-label="expand"
              >
                <Maximize2 size={12} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => closeModal(modal.id)}
                className="flex h-6 w-6 items-center justify-center text-ink-35 hover:text-ink-60"
                aria-label="close"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </div>
            <div className="calm-scroll h-[calc(100%-32px)] overflow-y-auto px-4 pb-4">
              <Room payload={modal.payload} />
            </div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}
