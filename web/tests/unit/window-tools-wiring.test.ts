/**
 * Tests for window-tool backend wiring.
 *
 * Verifies that key window tools (workflows_list_all, memories_list,
 * workflows_save, memories_search, memories_quick_add) call the correct
 * backend endpoints and emit UI events with real data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { workflowsWindowTools } from "../../lib/agent/window-tools/workflows";
import { memoriesWindowTools } from "../../lib/agent/window-tools/memories";
import { skillsWindowTools } from "../../lib/agent/window-tools/skills";
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
      grid: "",
      focusedId: null,
      recentActions: [],
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

/* ---------- workflows_list_all ---------- */

describe("workflows_list_all", () => {
  it("calls GET /api/kg/workflows and emits UI events with real data", async () => {
    const mockWorkflows = [
      { id: "wf:1", slug: "bug-triage", name: "Bug Triage", description: "Triage bugs" },
      { id: "wf:2", slug: "standup", name: "Daily Standup", description: "Run standup" },
    ];
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockWorkflows));

    const ctx = makeCtx();
    const tools = workflowsWindowTools(ctx);
    const result = await tools.workflows_list_all.execute!({}, { toolCallId: "t1", messages: [], abortSignal: undefined as unknown as AbortSignal });

    // Verify backend was called
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/kg/workflows");

    // Verify UI events were emitted with real data
    const toolEvent = ctx.events.find(
      (e) => e.type === "ui.tool" && "tool" in e && e.tool === "list_all",
    ) as Extract<AgentEvent, { type: "ui.tool" }> | undefined;
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.args?.data).toEqual(mockWorkflows);

    // Verify result string
    expect(result).toContain("2 workflow(s)");
  });

  it("returns error message when backend fails", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));

    const ctx = makeCtx();
    const tools = workflowsWindowTools(ctx);
    const result = await tools.workflows_list_all.execute!({}, { toolCallId: "t1", messages: [], abortSignal: undefined as unknown as AbortSignal });

    expect(result).toContain("Failed to list workflows");
    expect(result).toContain("network down");

    // Should emit tool.done with ok: false
    const doneEvent = ctx.events.find(
      (e) => e.type === "agent.tool.done",
    ) as Extract<AgentEvent, { type: "agent.tool.done" }> | undefined;
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.ok).toBe(false);
  });
});

/* ---------- workflows_save ---------- */

describe("workflows_save", () => {
  it("calls POST /api/kg/workflows before emitting UI events", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "wf:new", slug: "my-flow" }),
    );

    const ctx = makeCtx();
    const tools = workflowsWindowTools(ctx);
    const input = {
      slug: "my-flow",
      name: "My Flow",
      description: "A test workflow",
      trigger: "manual",
      outcome: undefined,
      frequency: undefined,
      tags: undefined,
      skill_chain: undefined,
    };
    const result = await tools.workflows_save.execute!(input, { toolCallId: "t2", messages: [], abortSignal: undefined as unknown as AbortSignal });

    // Verify backend was called with POST
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain("/api/kg/workflows");
    expect(calledOpts.method).toBe("POST");

    // Verify body contains the workflow data
    const body = JSON.parse(calledOpts.body);
    expect(body.slug).toBe("my-flow");
    expect(body.name).toBe("My Flow");

    // Verify result
    expect(result).toContain("Saved workflow");
    expect(result).toContain("my-flow");
  });

  it("returns error and does not emit save UI events on backend failure", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ detail: "DB unavailable" }, 500),
    );

    const ctx = makeCtx();
    const tools = workflowsWindowTools(ctx);
    const input = {
      slug: "broken",
      name: "Broken",
      description: "Will fail",
      trigger: undefined,
      outcome: undefined,
      frequency: undefined,
      tags: undefined,
      skill_chain: undefined,
    };
    const result = await tools.workflows_save.execute!(input, { toolCallId: "t3", messages: [], abortSignal: undefined as unknown as AbortSignal });

    expect(result).toContain("Failed to save workflow");
    // Should NOT have emitted a ui.tool save event
    const saveEvent = ctx.events.find(
      (e) => e.type === "ui.tool" && "tool" in e && e.tool === "save",
    );
    expect(saveEvent).toBeUndefined();
  });
});

/* ---------- memories_list ---------- */

describe("memories_list", () => {
  it("calls GET /api/kg/memories and emits UI events with real data", async () => {
    const mockMemories = [
      { id: "mem:1", content: "User likes Python", memory_type: "preference", confidence: 0.9 },
      { id: "mem:2", content: "Prefers dark mode", memory_type: "preference", confidence: 0.8 },
    ];
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockMemories));

    const ctx = makeCtx();
    const tools = memoriesWindowTools(ctx);
    const result = await tools.memories_list.execute!({}, { toolCallId: "t4", messages: [], abortSignal: undefined as unknown as AbortSignal });

    // Verify backend was called
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/kg/memories");

    // Verify UI events include real data
    const toolEvent = ctx.events.find(
      (e) => e.type === "ui.tool" && "tool" in e && e.tool === "list",
    ) as Extract<AgentEvent, { type: "ui.tool" }> | undefined;
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.args?.data).toEqual(mockMemories);
  });

  it("returns error message when backend fails", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("timeout"));

    const ctx = makeCtx();
    const tools = memoriesWindowTools(ctx);
    const result = await tools.memories_list.execute!({}, { toolCallId: "t5", messages: [], abortSignal: undefined as unknown as AbortSignal });

    expect(result).toContain("Failed to list memories");
  });
});

/* ---------- memories_quick_add ---------- */

describe("memories_quick_add", () => {
  it("calls POST /api/kg/memories when content is provided", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "mem:new", memory_id: "mem:new" }),
    );

    const ctx = makeCtx();
    const tools = memoriesWindowTools(ctx);
    const input = {
      content: "Remember this fact",
      memory_type: "fact",
      confidence: 0.95,
      about_entity_id: undefined,
      about_integration_slug: undefined,
    };
    await tools.memories_quick_add.execute!(input, { toolCallId: "t6", messages: [], abortSignal: undefined as unknown as AbortSignal });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain("/api/kg/memories");
    expect(calledOpts.method).toBe("POST");

    const body = JSON.parse(calledOpts.body);
    expect(body.content).toBe("Remember this fact");
  });

  it("still emits UI events even without content (no backend call)", async () => {
    const ctx = makeCtx();
    const tools = memoriesWindowTools(ctx);
    const input = {
      content: undefined,
      memory_type: undefined,
      confidence: undefined,
      about_entity_id: undefined,
      about_integration_slug: undefined,
    };
    await tools.memories_quick_add.execute!(input, { toolCallId: "t7", messages: [], abortSignal: undefined as unknown as AbortSignal });

    // No backend call
    expect(fetchSpy).not.toHaveBeenCalled();

    // But UI events should still be emitted
    expect(ctx.events.length).toBeGreaterThan(0);
  });
});

/* ---------- skills_list_all ---------- */

describe("skills_list_all", () => {
  it("calls GET /api/kg/skills and emits UI events with real data", async () => {
    const mockSkills = [
      { id: "sk:1", slug: "summarize", name: "Summarize", description: "Summarize text", strength: 80 },
    ];
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockSkills));

    const ctx = makeCtx();
    const tools = skillsWindowTools(ctx);
    const result = await tools.skills_list_all.execute!({}, { toolCallId: "t8", messages: [], abortSignal: undefined as unknown as AbortSignal });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/kg/skills");

    const toolEvent = ctx.events.find(
      (e) => e.type === "ui.tool" && "tool" in e && e.tool === "list_all",
    ) as Extract<AgentEvent, { type: "ui.tool" }> | undefined;
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.args?.data).toEqual(mockSkills);
  });
});
