/**
 * Tests for kgWriteTools — verifies all 7 tools are returned and each
 * tool's execute calls the backend, emits the correct UI events, and
 * returns a result string.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { kgWriteTools } from "../../lib/agent/kg-write-tools";
import type { AgentToolCtx } from "../../lib/agent/tools";
import type { AgentEvent } from "../../lib/agent-client";

/* ---------- helpers ---------- */

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeCtx(): AgentToolCtx & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    snapshot: {
      windows: [],
      viewport: { w: 1920, h: 1080 },
      recentActions: [],
      grid: "",
      focusedId: null,
      user: { query: "" },
    } as AgentToolCtx["snapshot"],
    emit: (e: AgentEvent) => events.push(e),
    events,
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

/* ---------- structural ---------- */

describe("kgWriteTools structure", () => {
  it("returns all 7 tools", () => {
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    const names = Object.keys(tools);
    expect(names).toContain("add_memory");
    expect(names).toContain("upsert_entity");
    expect(names).toContain("upsert_skill");
    expect(names).toContain("upsert_workflow");
    expect(names).toContain("add_chat");
    expect(names).toContain("write_wiki_page");
    expect(names).toContain("update_user");
    expect(names).toHaveLength(7);
  });
});

/* ---------- execution ---------- */

describe("kgWriteTools execution", () => {
  it("add_memory calls backend and emits ui.tool.open for memories", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "rec:1", memory_id: "mem:1" }),
    );
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    const result = await tools.add_memory.execute!(
      { content: "test memory", memory_type: "fact", confidence: 0.9 },
      { toolCallId: "tc1", messages: [], abortSignal: undefined as never },
    );
    expect(typeof result).toBe("string");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const toolOpen = ctx.events.find((e) => e.type === "ui.tool.open");
    expect(toolOpen).toBeDefined();
    if (toolOpen && toolOpen.type === "ui.tool.open") {
      expect(toolOpen.kind).toBe("memories");
    }
  });

  it("upsert_entity calls backend and emits ui.tool.open for entities", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "ent:1", slug: "test-entity" }),
    );
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    const result = await tools.upsert_entity.execute!(
      { name: "Jordan", entity_type: "person", description: "founder" },
      { toolCallId: "tc2", messages: [], abortSignal: undefined as never },
    );
    expect(typeof result).toBe("string");
    const toolOpen = ctx.events.find((e) => e.type === "ui.tool.open");
    expect(toolOpen).toBeDefined();
    if (toolOpen && toolOpen.type === "ui.tool.open") {
      expect(toolOpen.kind).toBe("entities");
    }
  });

  it("upsert_skill calls backend and emits ui.tool.open for skills", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "skill:1", slug: "test-skill" }),
    );
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    const result = await tools.upsert_skill.execute!(
      { slug: "test-skill", name: "Test Skill", description: "does things" },
      { toolCallId: "tc3", messages: [], abortSignal: undefined as never },
    );
    expect(typeof result).toBe("string");
    const toolOpen = ctx.events.find((e) => e.type === "ui.tool.open");
    expect(toolOpen).toBeDefined();
    if (toolOpen && toolOpen.type === "ui.tool.open") {
      expect(toolOpen.kind).toBe("skills");
    }
  });

  it("upsert_workflow calls backend and emits ui.tool.open for workflows", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "wf:1", slug: "test-wf" }),
    );
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    const result = await tools.upsert_workflow.execute!(
      { slug: "test-wf", name: "Test WF", description: "a workflow" },
      { toolCallId: "tc4", messages: [], abortSignal: undefined as never },
    );
    expect(typeof result).toBe("string");
    const toolOpen = ctx.events.find((e) => e.type === "ui.tool.open");
    expect(toolOpen).toBeDefined();
    if (toolOpen && toolOpen.type === "ui.tool.open") {
      expect(toolOpen.kind).toBe("workflows");
    }
  });

  it("add_chat calls backend and emits ui.tool.open for chats_summary", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "rec:1", chat_id: "chat:1" }),
    );
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    const result = await tools.add_chat.execute!(
      { content: "hello", source_type: "slack", signal_level: "high" },
      { toolCallId: "tc5", messages: [], abortSignal: undefined as never },
    );
    expect(typeof result).toBe("string");
    const toolOpen = ctx.events.find((e) => e.type === "ui.tool.open");
    expect(toolOpen).toBeDefined();
    if (toolOpen && toolOpen.type === "ui.tool.open") {
      expect(toolOpen.kind).toBe("chats_summary");
    }
  });

  it("write_wiki_page calls backend and emits ui.tool.open for wiki", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ path: "onboarding/setup", revision: 1 }),
    );
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    const result = await tools.write_wiki_page.execute!(
      { path: "onboarding/setup", content: "# Setup" },
      { toolCallId: "tc6", messages: [], abortSignal: undefined as never },
    );
    expect(typeof result).toBe("string");
    const toolOpen = ctx.events.find((e) => e.type === "ui.tool.open");
    expect(toolOpen).toBeDefined();
    if (toolOpen && toolOpen.type === "ui.tool.open") {
      expect(toolOpen.kind).toBe("wiki");
    }
  });

  it("update_user calls backend and emits ui.tool.open for profile", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        id: "user:1",
        name: "Jordan",
        role: "dev",
        goals: [],
        preferences: {},
        context_window: 4096,
        created_at: "",
        updated_at: "",
        chat_count: 0,
        memory_count: 0,
        entity_count: 0,
        skill_count: 0,
        workflow_count: 0,
        integration_count: 0,
      }),
    );
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    const result = await tools.update_user.execute!(
      { name: "Jordan", role: "dev" },
      { toolCallId: "tc7", messages: [], abortSignal: undefined as never },
    );
    expect(typeof result).toBe("string");
    const toolOpen = ctx.events.find((e) => e.type === "ui.tool.open");
    expect(toolOpen).toBeDefined();
    if (toolOpen && toolOpen.type === "ui.tool.open") {
      expect(toolOpen.kind).toBe("profile");
    }
  });

  it("each tool emits agent.tool.start and agent.tool.done events", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "rec:1", memory_id: "mem:1" }),
    );
    const ctx = makeCtx();
    const tools = kgWriteTools(ctx);
    await tools.add_memory.execute!(
      { content: "test" },
      { toolCallId: "tc8", messages: [], abortSignal: undefined as never },
    );
    const starts = ctx.events.filter((e) => e.type === "agent.tool.start");
    const dones = ctx.events.filter((e) => e.type === "agent.tool.done");
    expect(starts).toHaveLength(1);
    expect(dones).toHaveLength(1);
    if (starts[0] && starts[0].type === "agent.tool.start") {
      expect(starts[0].name).toBe("add_memory");
    }
  });
});
