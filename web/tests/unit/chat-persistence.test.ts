/**
 * Unit tests for web/lib/chat-persistence.ts.
 * Mocks global fetch and verifies persistChatMessage calls the right
 * endpoint with the right payload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { persistChatMessage } from "../../lib/chat-persistence";
import type { ChatMessage } from "../../lib/store";

/* ---------- helpers ---------- */

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

/* ---------- persistChatMessage ---------- */

describe("persistChatMessage", () => {
  it("sends POST /api/kg/chats with source_type ui_chat", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "chat:1" }, 201));

    const msg: ChatMessage = {
      id: "user-1234",
      role: "user",
      text: "hello world",
      ts: 1714128000000,
      status: "done",
    };
    await persistChatMessage(msg, "user-1");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/kg/chats");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.content).toBe("hello world");
    expect(body.source_type).toBe("ui_chat");
    expect(body.source_id).toBe("user-1234");
    expect(body.role).toBe("user");
    expect(body.signal_level).toBe("mid");
    expect(body.occurred_at).toBe(new Date(msg.ts).toISOString());
    expect(init.headers["X-User-Id"]).toBe("user-1");
  });

  it("does not throw on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));

    const msg: ChatMessage = {
      id: "user-5678",
      role: "user",
      text: "should not throw",
      ts: Date.now(),
      status: "done",
    };
    // Should resolve without throwing.
    await expect(persistChatMessage(msg)).resolves.toBeUndefined();
  });

  it("does not throw on 500 response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "server error" }), { status: 500 }),
    );

    const msg: ChatMessage = {
      id: "user-9999",
      role: "agent",
      text: "server fail",
      ts: Date.now(),
      status: "done",
    };
    await expect(persistChatMessage(msg)).resolves.toBeUndefined();
  });
});
