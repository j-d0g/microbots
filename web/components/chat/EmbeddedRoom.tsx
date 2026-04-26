"use client";

import { useAgentStore, type RoomKind } from "@/lib/store";
import { BriefRoom } from "@/components/rooms/BriefRoom";
import { GraphRoom } from "@/components/rooms/GraphRoom";
import { WorkflowRoom } from "@/components/rooms/WorkflowRoom";
import { StackRoom } from "@/components/rooms/StackRoom";
import { WaffleRoom } from "@/components/rooms/WaffleRoom";
import { PlaybooksRoom } from "@/components/rooms/PlaybooksRoom";
import { SettingsRoom } from "@/components/rooms/SettingsRoom";
import { IntegrationRoom } from "@/components/rooms/IntegrationRoom";
import { cn } from "@/lib/cn";

const ROOM_COMPONENTS: Record<
  RoomKind,
  React.ComponentType<{ payload?: Record<string, unknown> }>
> = {
  brief: BriefRoom,
  graph: GraphRoom,
  workflow: WorkflowRoom,
  stack: StackRoom,
  waffle: WaffleRoom,
  playbooks: PlaybooksRoom,
  settings: SettingsRoom,
  integration: IntegrationRoom,
};

const ROOM_LABEL: Record<RoomKind, string> = {
  brief: "brief",
  graph: "graph",
  workflow: "workflows",
  stack: "stack",
  waffle: "waffle",
  playbooks: "playbooks",
  settings: "settings",
  integration: "integration",
};

/**
 * Full-bleed room renderer for chat mode. No window chrome, no resize
 * handles — just the room's own content laid out to fill the right pane.
 *
 * Internally rooms have their own max-w + mx-auto centering, so we let
 * them breathe inside a comfortable inset rather than fighting against
 * their typography.
 */
export function EmbeddedRoom() {
  const room = useAgentStore((s) => s.chatRoom);
  const Room = ROOM_COMPONENTS[room];

  return (
    <div className="relative flex h-full w-full flex-col bg-paper-0">
      {/* Slim contextual header — what room is mounted, in MUJI overline.
          Right side intentionally left empty so the SnapshotInspector
          chip (top-right in chat mode) has a clean home. */}
      <div className="flex h-9 shrink-0 items-center border-b border-rule px-5">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-35"
          data-testid="embedded-room-label"
        >
          window · {ROOM_LABEL[room]}
        </span>
      </div>

      {/* Body. Rooms set their own padding via the WindowFrame in
          windowed mode; here we apply equivalent padding ourselves so
          the layouts stay visually identical. */}
      <div
        className={cn(
          "muji-scroll flex-1 overflow-y-auto overflow-x-hidden",
          // graph is the only room that draws a canvas — it manages its
          // own overflow and shouldn't get padding.
          room === "graph" ? "p-0" : "p-6 sm:p-8",
        )}
        data-testid={`embedded-room-${room}`}
      >
        <Room />
      </div>
    </div>
  );
}
