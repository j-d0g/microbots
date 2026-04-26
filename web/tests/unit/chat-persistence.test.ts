/**
 * Unit tests for web/lib/chat-persistence.ts.
 * Mocks global fetch and verifies persistChatMessage calls the right
 * endpoint with the right payload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { persistChatMessage, hydrateChatHistory } from "../../lib/chat-persistence";
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
    expect(body.signal_level).toBe("mid");
    expect(body.occurred_at).toBeTruthy();
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

/* ---------- hydrateChatHistory ---------- */

describe("hydrateChatHistory", () => {
  it("fetches GET /api/kg/chats with source_type=ui_chat and returns ChatMessage[]", async () => {
    const rows = [
      {
        id: "chat:abc",
        content: "agent reply",
        source_type: "ui_chat",
        source_id: "agent-100",
        occurred_at: "2026-04-26T12:01:00.000Z",
      },
      {
        id: "chat:def",
        content: "user msg",
        source_type: "ui_chat",
        source_id: "user-100",
        occurred_at: "2026-04-26T12:00:00.000Z",
      },
    ];
    fetchSpy.mockResolvedValueOnce(jsonResponse(rows));

    const msgs = await hydrateChatHistory("user-1", 50);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/kg/chats");
    expect(url).toContain("source_type=ui_chat");
    expect(url).toContain("limit=50");

    // Rows come newest-first from API; hydrate reverses to chronological.
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe("user-100");
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].text).toBe("user msg");
    expect(msgs[1].id).toBe("agent-100");
    expect(msgs[1].role).toBe("agent");
    expect(msgs[1].text).toBe("agent reply");
    expect(msgs[0].status).toBe("done");
    expect(msgs[1].status).toBe("done");
  });

  it("returns empty array on empty response", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));

    const msgs = await hydrateChatHistory(null, 10);
    expect(msgs).toEqual([]);
  });
});
