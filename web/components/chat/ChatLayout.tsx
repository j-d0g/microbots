"use client";

import { ChatPanel } from "./ChatPanel";
import { EmbeddedRoom } from "./EmbeddedRoom";

/**
 * Chat mode: split view.
 *
 * - Left: persistent chat panel (history + input + voice).
 * - Right: a single embedded room, full-bleed (no window chrome).
 *
 * The agent picks the room via `ui.room`; in chat mode this swaps the
 * focused room rather than opening a new window. Resize/arrange events
 * are no-ops here — by design — but in-window tools (`ui.tool`) still
 * fire so the agent can navigate inside the room.
 *
 * On wide viewports the chat panel is a fixed-width column; on narrow
 * viewports the layout stacks vertically (chat on top, room below).
 */
export function ChatLayout() {
  return (
    <div
      className="fixed inset-0 flex flex-col bg-paper-0 md:flex-row"
      data-testid="chat-layout"
    >
      <div className="h-1/2 w-full shrink-0 md:h-full md:w-[max(360px,35vw)]">
        <ChatPanel />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <EmbeddedRoom />
      </div>
    </div>
  );
}
