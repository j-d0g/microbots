/**
 * Chat persistence helpers.
 *
 * Fire-and-forget writer for individual chat messages in the KG.
 *
 * Design:
 *   - `persistChatMessage` is intentionally async-void: errors land in
 *     the console but never block UI rendering or the SSE stream.
 */

import type { ChatMessage } from "./store";
import { addChat } from "./api/backend";

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
        role: msg.role === "agent" ? "assistant" : "user",
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
