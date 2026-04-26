"use client";

import { useEffect } from "react";
import { ChatPanel } from "./ChatPanel";
import { EmbeddedRoom } from "./EmbeddedRoom";
import { useAgentStore } from "@/lib/store";
import { getDummyPayload } from "@/lib/chat-dummy-payloads";

/**
 * Chat mode: split view.
 *
 * - Left: persistent chat panel (history + input + voice).
 * - Right: a single embedded window of the active `chatRoom` kind,
 *   rendered with the same component as the windowed Stage Manager.
 *
 * The agent picks the room via `ui.room` / `ui.tool.open` and in chat
 * mode we surface the most-recent window of that kind on the right.
 * Resize/arrange events are no-ops here — chat mode is "one focal
 * window at a time, by design" — but in-window tools (`ui.tool`)
 * still fire so the agent can drive content inside the room.
 *
 * On wide viewports the chat panel is a fixed-width column; on narrow
 * viewports the layout stacks vertically (chat on top, room below).
 */
export function ChatLayout() {
  const chatRoom = useAgentStore((s) => s.chatRoom);

  /* Bootstrap: ensure the active chatRoom is backed by a real window
   * the moment chat mode mounts. Without this the right pane would
   * fall back to a dummy payload that disappears as soon as any agent
   * traffic lands; seeding the windows array up-front means the
   * rendering path is identical from frame zero. The seed payload is
   * the same dummy data the room tabs use. */
  useEffect(() => {
    const s = useAgentStore.getState();
    const existing = s.windows.find(
      (w) => w.kind === chatRoom && !w.minimized,
    );
    if (existing) {
      s.bringToFront(existing.id);
      return;
    }
    s.openWindow(chatRoom, { payload: getDummyPayload(chatRoom) });
    // chatRoom is intentionally the only dependency — re-running on
    // window-array changes would loop.
  }, [chatRoom]);

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
