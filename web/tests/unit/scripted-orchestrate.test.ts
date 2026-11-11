import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { applyAgentEvent, type AgentEvent } from "@/lib/agent-client";
import { POST } from "@/app/api/agent/orchestrate/route";
import { activeModelSlug } from "@/lib/agent/providers/openrouter";
import { buildSnapshot } from "@/lib/agent/snapshot";
import { useAgentStore, type ChatMessage } from "@/lib/store";
import { scriptedResponse } from "@/lib/agent/providers/scripted";
import { memoryCardSearchDisplay } from "@/components/chat/cards/memory-card-data";
import { formatTokens } from "@/components/chat/ChatMessage";

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

function healthyBackend() {
  return Response.json({
    status: "ok",
    service: "microbots",
    surreal: { ok: true, table_count: 31 },
    composio: { ok: false, configured: false },
  });
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
  it("rejects chat turns while the knowledge graph API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));

    const response = await POST(request("what can you do?", buildSnapshot()));

    expect(response.status).toBe(503);
  });

  it("selects scripted mode without a key, regardless of model preference", async () => {
    vi.stubEnv("MICROBOTS_AGENT_MODEL", "openai/gpt-4o");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(activeModelSlug()).toBe("scripted");
  });

  it("opens Today and summarizes its returned data in the morning brief", async () => {
    vi.stubEnv("MICROBOTS_AGENT_MODEL", "scripted");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/health")) return healthyBackend();
      if (String(input).includes("/api/kg/today")) {
        return Response.json({
          needs_you: [{
            id: "automation_candidate:question",
            title: "Review the release note",
            status: "open",
            signal_axes: { kind: "question", risk_tier: 2 },
            evidence: [],
          }],
          suggestions: [
            {
              id: "automation_candidate:pr",
              title: "Draft PR review summaries for Bob",
              status: "open",
              signal_axes: { kind: "automation", risk_tier: 2 },
              evidence: [{ type: "chat", id: "chat:github_pr_schema", text: "PR reviews" }],
            },
            {
              id: "automation_candidate:linear",
              title: "Auto-file Linear tickets from #bugs",
              status: "open",
              signal_axes: { kind: "automation", risk_tier: 2 },
              evidence: [{ type: "chat", id: "chat:linear_ticket_triage", text: "Bug triage" }],
            },
          ],
          recent: [],
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
      kind: "today",
      payload: expect.objectContaining({
        suggestions: expect.arrayContaining([
          expect.objectContaining({ title: "Draft PR review summaries for Bob" }),
        ]),
      }),
    }));
    expect(events.filter((event) => event.type === "reply.chunk").map((event) =>
      event.type === "reply.chunk" ? event.text : "",
    ).join("")).toBe("1 thing needs you; 2 automations are worth a look.");
    expect(scriptedResponse("morning brief").toolCalls).toEqual([
      { name: "today", input: {} },
    ]);

    resetStore();
    for (const event of events) applyAgentEvent(event);
    const morning = buildSnapshot();
    expect(morning.recentCards.map((card) => card.kind)).toEqual(["today"]);

    const clearResponse = await POST(request("close", morning));
    const clearEvents = readEvents(await clearResponse.text());
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

  it("saves a remembered fact, opens it in a memories card, and replies saved", async () => {
    vi.stubEnv("MICROBOTS_AGENT_MODEL", "scripted");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/api/health")) return healthyBackend();
      if (url.pathname.endsWith("/api/kg/memories") && init?.method === "POST") {
        return Response.json(
          { id: "memory:carol_release", memory_id: "carol_release" },
          { status: 201 },
        );
      }
      return Response.json([]);
    }));

    const response = await POST(request(
      "remember that Carol owns the release checklist",
      buildSnapshot(),
    ));
    const events = readEvents(await response.text());
    expect(events).toContainEqual(expect.objectContaining({
      type: "ui.tool.open",
      kind: "memories",
      payload: expect.objectContaining({
        query: "Carol owns the release checklist",
        results: [expect.objectContaining({
          snippet: "Carol owns the release checklist",
        })],
      }),
    }));
    expect(events.filter((event) => event.type === "reply.chunk")
      .map((event) => event.type === "reply.chunk" ? event.text : "").join(""))
      .toBe("Saved.");
  });

  it("opens the top deploy workflow card and answers from its search result", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/health")) return healthyBackend();
      return Response.json({
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
      });
    }));
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

  it("opens the focused Linear graph and answers from its visible neighbors", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/api/health")) return healthyBackend();
      if (path.endsWith("/integrations")) {
        return Response.json([
          { slug: "linear", name: "Linear", co_used_with_slugs: [
            { out: { slug: "notion" } },
          ] },
          { slug: "slack", name: "Slack", co_used_with_slugs: [
            { out: { slug: "linear" } },
          ] },
          { slug: "github", name: "GitHub", co_used_with_slugs: [
            { out: { slug: "linear" } },
          ] },
          { slug: "notion", name: "Notion" },
        ]);
      }
      if (path.endsWith("/entities")) {
        return Response.json([{ id: "entity:bob", name: "Bob", integration_slugs: ["linear"] }]);
      }
      if (path.endsWith("/skills")) {
        return Response.json([{
          id: "skill:triage", slug: "triage", name: "Triage",
          strength: 1, steps: [], integrations: ["linear"],
        }]);
      }
      if (path.endsWith("/workflows")) {
        return Response.json([{
          id: "workflow:bug-triage", slug: "bug-triage", name: "Bug Triage",
          skill_chain: [{ skill_slug: "triage", step_order: 1 }],
        }]);
      }
      return Response.json([]);
    }));
    const response = await POST(
      request("what's connected to Linear?", buildSnapshot()),
    );
    const events = readEvents(await response.text());
    expect(events.filter((event) => event.type === "reply.chunk")
      .map((event) => event.type === "reply.chunk" ? event.text : "").join(""))
      .toContain("GitHub, Notion, Slack and 3 more.");
    expect(events).toContainEqual(expect.objectContaining({
      type: "ui.canvas",
      action: expect.objectContaining({
        type: "open",
        kind: "graph",
        payload: { focus: "linear" },
      }),
    }));
  });

  it("routes entity hits to entity detail and answers with one description sentence", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/health")) return healthyBackend();
      return Response.json({
        query: "bob",
        scope: "all",
        count: 1,
        results: [{
          kind: "entities",
          id: "entity:bob",
          focus: "entity:bob",
          name: "Bob",
          snippet: "Bob is the primary code reviewer. He owns review assignments.",
          score: 0.9,
        }],
      });
    }));
    const response = await POST(request("who is Bob?", buildSnapshot()));
    const events = readEvents(await response.text());
    expect(events).toContainEqual(expect.objectContaining({
      type: "ui.tool.open",
      kind: "entity_detail",
      payload: expect.objectContaining({ focus: "entity:bob" }),
    }));
    expect(events.filter((event) => event.type === "reply.chunk")
      .map((event) => event.type === "reply.chunk" ? event.text : "").join(""))
      .toBe("Bob: Bob is the primary code reviewer.");
  });

  it("keeps non-memory hits out of memory card results", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/health")) return healthyBackend();
      return Response.json({
        query: "context",
        scope: "all",
        count: 2,
        results: [
          { kind: "memories", id: "memory:1", snippet: "Run the deploy check.", score: 0.9 },
          { kind: "integrations", id: "integration:slack", name: "Slack", score: 0.8 },
        ],
      });
    }));
    const response = await POST(request("find context", buildSnapshot()));
    const events = readEvents(await response.text());
    expect(events).toContainEqual(expect.objectContaining({
      type: "ui.tool.open",
      kind: "memories",
      payload: expect.objectContaining({
        results: [expect.objectContaining({ kind: "memories" })],
      }),
    }));
  });
});

describe("scripted response mappings", () => {
  it.each([
    ["clear", "close"],
    ["brief", "today"],
    ["please draw a graph", "show"],
    ["close", "close"],
    ["focus memories", "show"],
    ["show me skills", "show"],
  ])("maps %j to the requested tool", (query, toolName) => {
    expect(scriptedResponse(query).toolCalls[0]?.name).toBe(toolName);
  });

  it("routes the morning brief to Today", () => {
    const brief = scriptedResponse("morning brief");
    expect(brief.toolCalls).toEqual([{ name: "today", input: {} }]);
    expect(brief.text).toBe("");
  });

  it("shows the focused integration graph and describes its neighbors", () => {
    expect(scriptedResponse("what's connected to Linear?").toolCalls).toEqual([
      { name: "show", input: { kind: "graph", focus: "linear" } },
    ]);
    expect(scriptedResponse("what's connected to Linear?", [{
      name: "show",
      output: {
        ok: true,
        kind: "graph",
        focus: "linear",
        neighbors: ["Slack", "GitHub", "Notion", "Bob"],
      },
    }]).text).toContain("Slack, GitHub, Notion and 1 more.");
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

  it("opens Today focused on automation suggestions", () => {
    expect(scriptedResponse("what should I automate?").toolCalls).toEqual([
      { name: "today", input: { focus: "suggestions" } },
    ]);
    expect(scriptedResponse("what can I automate").toolCalls).toEqual([
      { name: "today", input: { focus: "suggestions" } },
    ]);
  });

  it("opens Today focused on items that need the user", () => {
    expect(scriptedResponse("what needs me today?").toolCalls).toEqual([
      { name: "today", input: { focus: "needs_you" } },
    ]);
  });

  it("names the top suggestion and its evidence count", () => {
    expect(scriptedResponse("what should I automate?", [{
      name: "today",
      output: {
        ok: true,
        result: {
          suggestions: [{
            title: "Draft PR review summaries for Bob",
            status: "open",
            evidence: [{}, {}],
          }],
        },
      },
    }]).text).toBe("Draft PR review summaries for Bob is worth a look, based on 2 signals.");
  });

  it("uses capitalized singular and empty-state morning brief copy", () => {
    expect(scriptedResponse("morning brief", [{
      name: "today",
      output: {
        ok: true,
        result: {
          needs_you: [],
          suggestions: [{ status: "open" }, { status: "open" }],
        },
      },
    }]).text).toBe("Nothing needs you right now; 2 automations are worth a look.");
    expect(scriptedResponse("morning brief", [{
      name: "today",
      output: {
        ok: true,
        result: {
          needs_you: [],
          suggestions: [{ status: "open" }],
        },
      },
    }]).text).toBe("Nothing needs you right now; 1 automation is worth a look.");
    expect(scriptedResponse("what needs me today?", [{
      name: "today",
      output: { ok: true, result: { needs_you: [], suggestions: [] } },
    }]).text).toBe("Nothing needs you right now.");
  });

  it("answers a memory search with the found sentence", () => {
    expect(scriptedResponse("who owns the release checklist?", [{
      name: "search",
      output: {
        ok: true,
        result: {
          results: [{
            kind: "memories",
            snippet: "Carol owns the release checklist",
          }],
        },
      },
    }]).text).toBe("Carol owns the release checklist.");
  });

  it("routes remember that statements to the real memory tool and says saved", () => {
    expect(scriptedResponse("remember that Carol owns the release checklist").toolCalls)
      .toEqual([{
        name: "remember",
        input: { text: "Carol owns the release checklist" },
      }]);
    expect(scriptedResponse("remember that Carol owns the release checklist", [{
      name: "remember",
      output: { ok: true, result: { id: "memory:carol_release" } },
    }]).text).toBe("Saved.");
  });

  it("returns four demo prompts for capability questions", () => {
    expect(scriptedResponse("what can you do?")).toEqual({
      toolCalls: [],
      text: "I can search your graph, show focused cards, remember facts, and help shape workflows. Try “what needs me today?”, “what’s connected to Linear?”, “who is Bob?”, or “what should I automate?”.",
    });
  });

  it("searches instead of clearing on a non-command phrase", () => {
    expect(scriptedResponse("help me clear my head about deploys").toolCalls).toEqual([
      { name: "search", input: { query: "help me clear my head about deploys", scope: "all" } },
    ]);
  });

  it("searches for the name in a who-is question", () => {
    expect(scriptedResponse("who is Bob?").toolCalls).toEqual([
      { name: "search", input: { query: "bob", scope: "all" } },
    ]);
  });

  it("searches for the topic in a tell-me-about question", () => {
    expect(scriptedResponse("tell me about deploys").toolCalls).toEqual([
      { name: "search", input: { query: "deploy", scope: "all" } },
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

describe("reply token usage", () => {
  it("omits usage on reply.done when the model reports no tokens", async () => {
    vi.stubEnv("MICROBOTS_AGENT_MODEL", "scripted");
    vi.stubGlobal("fetch", vi.fn(async () => healthyBackend()));

    const response = await POST(request("what can you do?", buildSnapshot()));
    const events = readEvents(await response.text());
    const done = events.find((event) => event.type === "reply.done");

    expect(done).toBeDefined();
    expect(done && "usage" in done ? done.usage : undefined).toBeUndefined();
  });

  it("stores the usage reported with reply.done on the finished agent message", () => {
    applyAgentEvent({ type: "reply.start", query: "who is Bob?" });
    applyAgentEvent({ type: "reply.chunk", text: "bob reviews PRs." });
    applyAgentEvent({ type: "reply.done", usage: { inputTokens: 1200, outputTokens: 48 } });

    const last = useAgentStore.getState().chatMessages.at(-1) as ChatMessage;
    expect(last.role).toBe("agent");
    expect(last.status).toBe("done");
    expect(last.usage).toEqual({ inputTokens: 1200, outputTokens: 48 });
  });

  it("formats token counts compactly", () => {
    expect(formatTokens(812)).toBe("812");
    expect(formatTokens(1248)).toBe("1.2k");
    expect(formatTokens(2000)).toBe("2k");
    expect(formatTokens(15800)).toBe("16k");
  });
});
