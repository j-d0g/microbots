"use client";

import { useAgentStore, type WindowKind } from "@/lib/store";
import { GraphRoom } from "@/components/rooms/GraphRoom";
import { SettingsRoom } from "@/components/rooms/SettingsRoom";
import { cn } from "@/lib/cn";

/** Placeholder for tool windows not yet built (Phase 5). */
function PlaceholderEmbedded({ payload }: { payload?: Record<string, unknown> }) {
  return (
    <div className="flex items-center justify-center h-full text-ink-35 text-xs font-mono">
      window content pending
    </div>
  );
}

const ROOM_COMPONENTS: Record<
  WindowKind,
  React.ComponentType<{ payload?: Record<string, unknown> }>
> = {
  run_code: PlaceholderEmbedded,
  save_workflow: PlaceholderEmbedded,
  view_workflow: PlaceholderEmbedded,
  run_workflow: PlaceholderEmbedded,
  list_workflows: PlaceholderEmbedded,
  find_examples: PlaceholderEmbedded,
  search_memory: PlaceholderEmbedded,
  ask_user: PlaceholderEmbedded,
  graph: GraphRoom,
  settings: SettingsRoom,
};

const ROOM_LABEL: Record<WindowKind, string> = {
  run_code: "run code",
  save_workflow: "save workflow",
  view_workflow: "view workflow",
  run_workflow: "run workflow",
  list_workflows: "workflows",
  find_examples: "examples",
  search_memory: "memory",
  ask_user: "ask user",
  graph: "graph",
  settings: "settings",
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
