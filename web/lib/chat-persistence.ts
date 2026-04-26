/**
 * Chat persistence helpers.
 *
 * Fire-and-forget wrappers that push individual `ChatMessage` objects
 * to the KG backend (`POST /api/kg/chats`) and hydrate the Zustand
 * store from persisted history on page load.
 *
 * Design:
 *   - `persistChatMessage` is intentionally async-void: errors land in
 *     the console but never block UI rendering or the SSE stream.
 *   - `hydrateChatHistory` fetches the most recent `ui_chat` rows and
 *     maps them back into `ChatMessage[]` for the Zustand store.
 */

import type { ChatMessage } from "./store";
import { addChat, getChats } from "./kg-client";

/**
 * Persist a single chat message to the backend.
 * Fire-and-forget -- logs errors but never throws.
 */
export async function persistChatMessage(
  msg: ChatMessage,
  userId?: string | null,
): Promise<void> {
  try {
    await addChat(
      {
        content: msg.text,
        source_type: "ui_chat",
        source_id: msg.id,
        signal_level: "mid",
        occurred_at: new Date(msg.ts).toISOString(),
      },
      userId,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[chat-persistence] persistChatMessage failed:", err);
  }
}

/**
 * Fetch recent ui_chat messages from the backend and return them as
 * `ChatMessage[]` suitable for the Zustand store.
 *
 * Returns newest-first from the API, reversed here so the store has
 * chronological order (oldest first).
 */
export async function hydrateChatHistory(
  userId?: string | null,
  limit = 50,
): Promise<ChatMessage[]> {
  const rows = await getChats({ sourceType: "ui_chat", limit }, userId);

  // Map SurrealDB chat rows back to the frontend ChatMessage shape.
  // The `source_id` was set to the original `msg.id` on persist, so we
  // can recover it. Rows come newest-first from the API; reverse for
  // chronological store order.
  return rows
    .map((row): ChatMessage => ({
      id: row.source_id ?? row.id,
      // We cannot distinguish role from source_type alone; the
      // persistChatTurn in agent-client.ts writes both user and agent
      // messages with source_type "ui_chat". We use source_id prefix
      // as a heuristic: user messages have ids like "user-<ts>".
      role: row.source_id?.startsWith("user-") ? "user" : "agent",
      text: row.content,
      ts: row.occurred_at ? new Date(row.occurred_at).getTime() : Date.now(),
      status: "done",
    }))
    .reverse();
}
