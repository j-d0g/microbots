import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { applyAgentEvent, type AgentEvent } from "@/lib/agent-client";
import { GET, POST } from "@/app/api/agent/orchestrate/route";
import { buildSnapshot } from "@/lib/agent/snapshot";
import { useAgentStore } from "@/lib/store";
import { scriptedResponse } from "@/lib/agent/providers/scripted";
import { memoryCardSearchDisplay } from "@/components/chat/cards/memory-card-data";

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
    chatCanvasOpen: false,
    chatMessages: [],
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
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
      { type: "open", kind: "memories", openedBy: "agent" },
      {
        type: "open",
        kind: "workflows",
        payload: { focus: "Bug Triage" },
        openedBy: "agent",
      },
    ]);
    expect(events.findIndex((event) => event.type === "agent.tool.start"))
      .toBeLessThan(events.findIndex((event) => event.type === "reply.chunk"));
    expect(events.filter((event) => event.type === "reply.chunk").map((event) =>
      event.type === "reply.chunk" ? event.text : "",
    ).join("")).toBe(
      "Your notes say to post in #deployments before and after every production deploy. Bug Triage is ready for a closer look.",
    );
    expect(scriptedResponse("morning brief").toolCalls[0]).toEqual({
      name: "search_memory",
      input: { query: "production deploy" },
    });

    resetStore();
    for (const event of events) applyAgentEvent(event);
    const morning = buildSnapshot({ viewport: { w: 1440, h: 900 } });
    expect(morning.windows.map((window) => window.kind)).toEqual(["memories", "workflows"]);
    expect(morning.windows.find((window) => window.kind === "workflows")?.payload)
      .toEqual({ focus: "Bug Triage" });

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
    ["brief", "search_memory"],
    ["please draw a graph", "open_window"],
    ["close memories", "close_window"],
    ["focus memories", "focus_window"],
    ["show me skills", "open_window"],
  ])("maps %j to the requested tool", (query, toolName) => {
    expect(scriptedResponse(query).toolCalls[0]?.name).toBe(toolName);
  });

  it("uses memory and focused window tools for the morning brief", () => {
    const brief = scriptedResponse("morning brief");
    expect(brief.toolCalls.map((call) => call.name)).toEqual([
      "search_memory",
      "open_window",
      "open_window",
    ]);
    expect(brief.toolCalls[0].input.query).toBe("production deploy");
    expect(brief.toolCalls[1].input).toEqual({ kind: "memories" });
    expect(brief.toolCalls[2].input).toEqual({ kind: "workflows", focus: "Bug Triage" });
    expect(brief.text).toContain("production deploy");
    expect(brief.text).toContain("#deployments");
    expect(brief.text).toContain("Bug Triage");
  });

  it("opens a focused graph for integration connections", () => {
    expect(scriptedResponse("what's connected to Linear?")).toEqual({
      toolCalls: [{ name: "open_window", input: { kind: "graph", focus: "Linear" } }],
      text: "Linear is connected in the knowledge graph to Notion.",
    });
    expect(scriptedResponse("what's connected to Slack?").text).toContain(
      "Perplexity, Linear, GitHub, and Notion",
    );
  });

  it.each([
    ["show me the Bug Triage workflow", "Bug Triage"],
    ["open the bug triage workflow", "Bug Triage"],
    ["bug triage", "Bug Triage"],
    ["show me the Deploy Pipeline workflow", "Deploy Pipeline"],
    ["show me the PR Review Cycle workflow", "PR Review Cycle"],
  ])("opens workflows focused on %s", (query, focus) => {
    expect(scriptedResponse(query).toolCalls).toEqual([
      { name: "open_window", input: { kind: "workflows", focus } },
    ]);
  });

  it("asks for a choice before automating PR reviews", () => {
    const response = scriptedResponse("should I automate PR reviews?");
    expect(response.toolCalls[0].name).toBe("ask_user");
    expect(response.toolCalls[0].input.options).toHaveLength(3);
    expect(response.text).toContain("draft suggestions");
  });

  it("returns the fallback prompt suggestions", () => {
    expect(scriptedResponse("hello")).toEqual({
      toolCalls: [],
      text: "scripted mode — try: morning brief, what's connected to Linear, show me the Bug Triage workflow, should I automate PR reviews?",
    });
  });
});

describe("chat message event attachments", () => {
  it("lazily creates a streaming message and updates deduplicated cards and tool traces", () => {
    resetStore();
    useAgentStore.setState({ uiMode: "chat" });
    applyAgentEvent({
      type: "ui.canvas",
      action: { type: "open", kind: "memories", payload: { query: "first" } },
    });
    const first = useAgentStore.getState().chatMessages[0];
    expect(first).toMatchObject({ role: "agent", text: "", status: "streaming" });
    expect(first.cards).toEqual([
      { id: expect.any(String), kind: "memories", payload: { query: "first" } },
    ]);

    applyAgentEvent({
      type: "ui.canvas",
      action: { type: "open", kind: "memories", payload: { query: "updated" } },
    });
    applyAgentEvent({
      type: "ui.canvas",
      action: { type: "open", kind: "workflows", payload: { focus: "Bug Triage" } },
    });
    applyAgentEvent({
      type: "agent.tool.start",
      name: "open_window",
      args: { kind: "workflows" },
    });
    applyAgentEvent({ type: "agent.tool.done", name: "open_window", ok: true });

    const message = useAgentStore.getState().chatMessages[0];
    expect(message.cards).toHaveLength(2);
    expect(message.cards?.[0]).toMatchObject({ kind: "memories", payload: { query: "updated" } });
    expect(message.cards?.[1]).toMatchObject({ kind: "workflows", payload: { focus: "Bug Triage" } });
    expect(message.tools?.[0]).toMatchObject({ name: "open_window", ok: true });
    expect(message.tools?.[0].ms).toEqual(expect.any(Number));
  });

  it("does not attach cards or tool traces in windowed mode", () => {
    resetStore();
    useAgentStore.setState({ uiMode: "windowed" });
    applyAgentEvent({
      type: "ui.canvas",
      action: { type: "open", kind: "memories" },
    });
    applyAgentEvent({ type: "agent.tool.start", name: "open_window", args: {} });
    applyAgentEvent({ type: "agent.tool.done", name: "open_window", ok: true });
    expect(useAgentStore.getState().chatMessages).toEqual([]);
  });

  it("does not create a message when a tool finishes without an active stream", () => {
    resetStore();
    const completedMessage = {
      id: "agent-finished",
      role: "agent" as const,
      text: "A completed reply.",
      ts: 1,
      status: "done" as const,
    };
    useAgentStore.setState({ chatMessages: [completedMessage] });

    useAgentStore.getState().finishChatToolTrace("open_window", true);

    expect(useAgentStore.getState().chatMessages).toEqual([completedMessage]);
  });

  it("opens and closes the conditional chat canvas", () => {
    resetStore();
    expect(useAgentStore.getState().chatCanvasOpen).toBe(false);
    useAgentStore.getState().openChatCanvas("settings");
    expect(useAgentStore.getState()).toMatchObject({
      chatCanvasOpen: true,
      chatRoom: "settings",
    });
    useAgentStore.getState().closeChatCanvas();
    expect(useAgentStore.getState().chatCanvasOpen).toBe(false);
  });
});

describe("memory card search results", () => {
  it("uses the first three result snippets and preserves the match count", () => {
    expect(memoryCardSearchDisplay({
      query: "production deploy",
      count: 4,
      results: [
        { snippet: "first" },
        { snippet: "second" },
        { snippet: "third" },
        { snippet: "fourth" },
      ],
    })).toEqual({
      query: "production deploy",
      count: 4,
      snippets: ["first", "second", "third"],
    });
  });

  it("distinguishes an empty search from an absent results payload", () => {
    expect(memoryCardSearchDisplay({ query: "nothing", count: 0, results: [] }))
      .toEqual({ query: "nothing", count: 0, snippets: [] });
    expect(memoryCardSearchDisplay({ query: "nothing" })).toBeNull();
  });
});
