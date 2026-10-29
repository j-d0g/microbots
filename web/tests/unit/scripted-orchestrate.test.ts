import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { applyAgentEvent, type AgentEvent } from "@/lib/agent-client";
import { POST } from "@/app/api/agent/orchestrate/route";
import { activeModelSlug } from "@/lib/agent/providers/openrouter";
import { buildSnapshot } from "@/lib/agent/snapshot";
import { useAgentStore, type ChatMessage } from "@/lib/store";
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
    chatRoom: "graph",
    room: "graph",
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
  it("selects scripted mode without a key, regardless of model preference", async () => {
    vi.stubEnv("MICROBOTS_AGENT_MODEL", "openai/gpt-4o");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(activeModelSlug()).toBe("scripted");
  });

  it("uses search results and focused cards in the morning brief SSE response", async () => {
    vi.stubEnv("MICROBOTS_AGENT_MODEL", "scripted");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/kg/search")) {
        return Response.json({
          query: "production deploy",
          scope: "all",
          count: 1,
          results: [{
            kind: "memories",
            id: "memory:deploy-checklist",
            name: "Deploy checklist",
            snippet: "Post in #deployments before and after every production deploy.",
            score: 0.9,
          }],
        });
      }
      return Response.json([]);
    }));
    const response = await POST(request("morning brief", buildSnapshot()));
    expect(response.status).toBe(200);
    const events = readEvents(await response.text());
    expect(events.findIndex((event) => event.type === "agent.tool.start"))
      .toBeLessThan(events.findIndex((event) => event.type === "reply.chunk"));
    expect(events).toContainEqual(expect.objectContaining({
      type: "ui.tool.open",
      kind: "memories",
      payload: expect.objectContaining({ query: "production deploy", count: 1 }),
    }));
    expect(events).toContainEqual({
      type: "ui.canvas",
      action: {
        type: "open",
        kind: "workflows",
        payload: { focus: "Bug Triage" },
        openedBy: "agent",
      },
    });
    expect(events.filter((event) => event.type === "reply.chunk").map((event) =>
      event.type === "reply.chunk" ? event.text : "",
    ).join("")).toContain("#deployments");
    expect(scriptedResponse("morning brief").toolCalls).toEqual([
      { name: "search", input: { query: "production deploy", scope: "all" } },
    ]);

    resetStore();
    for (const event of events) applyAgentEvent(event);
    const morning = buildSnapshot();
    expect(morning.recentCards.map((card) => card.kind)).toEqual(["memories", "workflows"]);

    const clearResponse = await POST(request("close", morning));
    const clearEvents = readEvents(await clearResponse.text());
    expect(clearEvents).toContainEqual({ type: "ui.canvas", action: { type: "close" } });
    expect(clearEvents.filter((event) => event.type === "reply.chunk").map((event) =>
      event.type === "reply.chunk" ? event.text : "",
    ).join("")).toBe("Closed the open card.");
    for (const event of clearEvents) applyAgentEvent(event);
    expect(useAgentStore.getState().chatMessages.length).toBeGreaterThan(0);

    const secondClose = await POST(request("close", buildSnapshot()));
    const secondCloseEvents = readEvents(await secondClose.text());
    expect(secondCloseEvents.filter((event) => event.type === "reply.chunk")
      .map((event) => event.type === "reply.chunk" ? event.text : "").join(""))
      .toBe("Nothing's open.");
  }, 15_000);

  it("opens the top deploy workflow card and answers from its search result", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      query: "tell me about deploys",
      scope: "all",
      count: 1,
      results: [{
        kind: "workflows",
        id: "workflow:deploy-pipeline",
        name: "Deploy Pipeline",
        focus: "deploy-pipeline",
        snippet: "Build, test, and deploy the application.",
        score: 0.95,
      }],
    })));
    const response = await POST(request("tell me about deploys", buildSnapshot()));
    const events = readEvents(await response.text());

    expect(events).toContainEqual(expect.objectContaining({
      type: "ui.tool.open",
      kind: "workflows",
      payload: expect.objectContaining({
        focus: "deploy-pipeline",
        results: [expect.objectContaining({ name: "Deploy Pipeline" })],
      }),
    }));
    expect(events.filter((event) => event.type === "reply.chunk")
      .map((event) => event.type === "reply.chunk" ? event.text : "").join(""))
      .toContain("Deploy Pipeline");
  });

  it("answers about Linear from neighbors returned by the backend", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      query: "Linear",
      scope: "all",
      count: 1,
      results: [{
        kind: "integrations",
        id: "integration:linear",
        name: "Linear",
        focus: "Linear",
        snippet: "Issue tracking",
        score: 0.9,
        connections: [{ slug: "notion", name: "Notion" }, { slug: "github", name: "GitHub" }],
      }],
    })));
    const response = await POST(
      request("what's connected to Linear?", buildSnapshot()),
    );
    const events = readEvents(await response.text());

    expect(events.filter((event) => event.type === "reply.chunk")
      .map((event) => event.type === "reply.chunk" ? event.text : "").join(""))
      .toContain("Notion and GitHub");
    expect(events).toContainEqual(expect.objectContaining({
      type: "ui.tool.open",
      kind: "integrations",
      payload: expect.objectContaining({ query: "linear" }),
    }));
  });
});

describe("scripted response mappings", () => {
  it.each([
    ["clear", "close"],
    ["brief", "search"],
    ["please draw a graph", "show"],
    ["close", "close"],
    ["focus memories", "show"],
    ["show me skills", "show"],
  ])("maps %j to the requested tool", (query, toolName) => {
    expect(scriptedResponse(query).toolCalls[0]?.name).toBe(toolName);
  });

  it("searches before showing a focused workflow for the morning brief", () => {
    const brief = scriptedResponse("morning brief");
    expect(brief.toolCalls).toEqual([
      { name: "search", input: { query: "production deploy", scope: "all" } },
    ]);
    expect(brief.text).toBe("");
  });

  it("searches real integration neighbors before answering", () => {
    expect(scriptedResponse("what's connected to Linear?").toolCalls).toEqual([
      { name: "search", input: { query: "linear", scope: "all" } },
    ]);
    expect(scriptedResponse("what's connected to Linear?", [{
      name: "search",
      output: { ok: true, result: { results: [{
        kind: "integrations", name: "Linear",
        connections: [{ name: "GitHub" }, { name: "Notion" }],
      }] } },
    }]).text).toContain("GitHub and Notion");
  });

  it.each([
    ["show me the Bug Triage workflow", "Bug Triage"],
    ["open the bug triage workflow", "Bug Triage"],
    ["bug triage", "Bug Triage"],
    ["show me the Deploy Pipeline workflow", "Deploy Pipeline"],
    ["show me the PR Review Cycle workflow", "PR Review Cycle"],
  ])("opens workflows focused on %s", (query, focus) => {
    expect(scriptedResponse(query).toolCalls).toEqual([
      { name: "show", input: { kind: "workflows", focus } },
    ]);
  });

  it("asks for a choice before automating PR reviews", () => {
    const response = scriptedResponse("should I automate PR reviews?");
    expect(response.toolCalls[0].name).toBe("ask_user");
    expect(response.toolCalls[0].input.options).toHaveLength(3);
    expect(response.text).toBe("");
  });

  it.each([
    ["Draft review suggestions", "draft review suggestions"],
    ["Ask before each review", "ask before each review"],
    ["Keep reviews manual", "keep reviews manual"],
  ])("acknowledges the PR-review choice %j without claiming automation", (choice, acknowledgement) => {
    const response = scriptedResponse(choice);

    expect(response.toolCalls).toEqual([]);
    expect(response.text).toContain(acknowledgement);
    expect(response.text).toContain("Nothing has been automated yet in this demo.");
  });

  it("returns four demo prompts for capability questions", () => {
    expect(scriptedResponse("what can you do?")).toEqual({
      toolCalls: [],
      text: "I can search your graph, show focused cards, remember facts, and help shape workflows. Try “morning brief”, “what’s connected to Linear?”, “who is Bob?”, or “tell me about deploys”.",
    });
  });

  it("searches instead of clearing on a non-command phrase", () => {
    expect(scriptedResponse("help me clear my head about deploys").toolCalls).toEqual([
      { name: "search", input: { query: "help me clear my head about deploys", scope: "all" } },
    ]);
  });

  it("answers honestly when close returns nothing open", () => {
    expect(scriptedResponse("close", [{
      name: "close",
      output: { ok: false, reason: "nothing open" },
    }]).text).toBe("Nothing's open.");
  });
});

describe("chat message event attachments", () => {
  it("persists an answer only on the matching chat card", () => {
    const messages: ChatMessage[] = [
      {
        id: "agent-ask",
        role: "agent",
        text: "How should I help?",
        ts: 1,
        status: "done",
        cards: [
          {
            id: "ask-1",
            kind: "ask_user",
            payload: { question: "How should I help?" },
          },
          { id: "graph-1", kind: "graph", payload: { focus: "Linear" } },
        ],
      },
      {
        id: "agent-other",
        role: "agent",
        text: "Another card.",
        ts: 2,
        status: "done",
        cards: [{ id: "ask-2", kind: "ask_user", payload: { question: "Other?" } }],
      },
    ];
    useAgentStore.setState({ chatMessages: messages });

    useAgentStore.getState().answerChatCard("ask-1", "Keep reviews manual");

    const updated = useAgentStore.getState().chatMessages;
    expect(updated[0].cards?.[0].payload).toEqual({
      question: "How should I help?",
      answer: "Keep reviews manual",
    });
    expect(updated[0].cards?.[1]).toBe(messages[0].cards?.[1]);
    expect(updated[1]).toBe(messages[1]);
  });

  it("lazily creates a streaming message and updates deduplicated cards and tool traces", () => {
    resetStore();
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
      name: "show",
      args: { kind: "workflows" },
    });
    applyAgentEvent({ type: "agent.tool.done", name: "show", ok: true });

    const message = useAgentStore.getState().chatMessages[0];
    expect(message.cards).toHaveLength(2);
    expect(message.cards?.[0]).toMatchObject({ kind: "memories", payload: { query: "updated" } });
    expect(message.cards?.[1]).toMatchObject({ kind: "workflows", payload: { focus: "Bug Triage" } });
    expect(message.tools?.[0]).toMatchObject({ name: "show", ok: true });
    expect(message.tools?.[0].ms).toEqual(expect.any(Number));
  });

  it("attaches cards and tool traces to the chat message", () => {
    resetStore();
    applyAgentEvent({
      type: "ui.canvas",
      action: { type: "open", kind: "memories" },
    });
    applyAgentEvent({ type: "agent.tool.start", name: "show", args: {} });
    applyAgentEvent({ type: "agent.tool.done", name: "show", ok: true });
    expect(useAgentStore.getState().chatMessages[0]).toMatchObject({
      role: "agent",
      cards: [{ kind: "memories" }],
      tools: [{ name: "show", ok: true }],
    });
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

    useAgentStore.getState().finishChatToolTrace("show", true);

    expect(useAgentStore.getState().chatMessages).toEqual([completedMessage]);
  });

  it("opens and closes the conditional chat canvas", () => {
    resetStore();
    expect(useAgentStore.getState().chatCanvasOpen).toBe(false);
    useAgentStore.getState().openChatCanvas("workflows");
    expect(useAgentStore.getState()).toMatchObject({
      chatCanvasOpen: true,
      chatRoom: "workflows",
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
