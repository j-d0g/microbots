import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { applyAgentEvent, type AgentEvent } from "@/lib/agent-client";
import { GET, POST } from "@/app/api/agent/orchestrate/route";
import { buildSnapshot } from "@/lib/agent/snapshot";
import { rectsForPreset } from "@/lib/agent/canvas-reducer";
import { useAgentStore } from "@/lib/store";
import { scriptedResponse } from "@/lib/agent/providers/scripted";

function readEvents(body: string): AgentEvent[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as AgentEvent);
}

function request(query: string, snapshot: ReturnType<typeof buildSnapshot>) {
  return new Request("http://localhost/api/agent/orchestrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, snapshot }),
  }) as NextRequest;
}

function resetStore() {
  useAgentStore.setState({
    windows: [],
    uiMode: "windowed",
    chatRoom: "chat",
    room: "chat",
    recentActions: [],
    canvasT0: 0,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetStore();
});

describe("scripted orchestrator model", () => {
  it("serves the real route and applies ordered morning-brief tools over SSE", async () => {
    vi.stubEnv("MICROBOTS_AGENT_MODEL", "scripted");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    expect(await (await GET()).json()).toEqual({ live: true });

    const response = await POST(request("morning brief", buildSnapshot({
      query: "",
      viewport: { w: 1440, h: 900 },
    })));
    expect(response.status).toBe(200);
    const events = readEvents(await response.text());
    const canvasActions = events
      .filter((event): event is Extract<AgentEvent, { type: "ui.canvas" }> => event.type === "ui.canvas")
      .map((event) => event.action);
    expect(canvasActions).toEqual([
      { type: "open", kind: "memories", mount: "full", openedBy: "agent" },
      { type: "open", kind: "workflows", mount: "full", openedBy: "agent" },
      { type: "arrange", layout: "split" },
    ]);
    expect(events.filter((event) => event.type === "reply.chunk").map((event) =>
      event.type === "reply.chunk" ? event.text : "",
    ).join("")).toBe("morning. here's your brief.");

    resetStore();
    for (const event of events) applyAgentEvent(event);
    const morning = buildSnapshot({ viewport: { w: 1440, h: 900 } });
    expect(morning.windows.map((window) => window.kind)).toEqual(["memories", "workflows"]);
    expect(morning.windows.map((window) => window.mount)).toEqual(["freeform", "freeform"]);
    const splitRects = rectsForPreset("split", 2);
    expect(morning.windows.map((window) => window.rect)).toEqual([
      splitRects[1],
      splitRects[0],
    ]);

    const clearResponse = await POST(request("close everything", morning));
    const clearEvents = readEvents(await clearResponse.text());
    expect(clearEvents).toContainEqual({
      type: "ui.canvas",
      action: { type: "clear" },
    });
    expect(clearEvents.filter((event) => event.type === "reply.chunk").map((event) =>
      event.type === "reply.chunk" ? event.text : "",
    ).join("")).toBe("cleared the canvas.");
    for (const event of clearEvents) applyAgentEvent(event);
    expect(useAgentStore.getState().windows).toHaveLength(0);
  });

  it("returns the existing local-fallback 503 when scripted mode is disabled", async () => {
    vi.stubEnv("MICROBOTS_AGENT_MODEL", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const response = await POST(new Request("http://localhost/api/agent/orchestrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }) as NextRequest);
    expect(response.status).toBe(503);
    expect(response.headers.get("x-agent-fallback")).toBe("local");
  });
});

describe("scripted response mappings", () => {
  it.each([
    ["clear", "clear_canvas"],
    ["clear graph filters", "graph_clear"],
    ["brief", "open_window"],
    ["please draw a graph", "open_window"],
    ["close memories", "close_window"],
    ["focus memories", "focus_window"],
    ["show me skills", "open_window"],
  ])("maps %j to the requested tool", (query, toolName) => {
    expect(scriptedResponse(query).toolCalls[0]?.name).toBe(toolName);
  });

  it("emits the morning brief tools in order and uses exact reply copy", () => {
    expect(scriptedResponse("morning brief")).toEqual({
      toolCalls: [
        { name: "open_window", input: { kind: "memories" } },
        { name: "open_window", input: { kind: "workflows" } },
        { name: "arrange_windows", input: { layout: "split" } },
      ],
      text: "morning. here's your brief.",
    });
  });

  it("returns the exact scripted fallback text", () => {
    expect(scriptedResponse("hello")).toEqual({
      toolCalls: [],
      text: "scripted mode — try: show me the graph, morning brief, focus memories, close everything",
    });
  });
});
