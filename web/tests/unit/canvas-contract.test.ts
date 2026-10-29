import { beforeEach, describe, expect, it } from "vitest";
import { ORCH_MAX_STEPS, ORCH_SYSTEM } from "@/lib/agent/orchestrator";
import { createAgentTools, createToolCtx } from "@/lib/agent/tools";
import type { AgentEvent } from "@/lib/agent-client";
import { applyCanvasAction, type CanvasState } from "@/lib/agent/canvas-reducer";
import { buildSnapshot } from "@/lib/agent/snapshot";
import { useAgentStore } from "@/lib/store";

const toolOptions = {
  toolCallId: "agent-contract",
  messages: [],
  abortSignal: new AbortController().signal,
};

async function executeTool(
  tool: unknown,
  input: Record<string, unknown>,
): Promise<unknown> {
  const execute = (tool as {
    execute: (
      input: Record<string, unknown>,
      options: typeof toolOptions,
    ) => Promise<unknown>;
  }).execute;
  return execute(input, toolOptions);
}

describe("agent tool and canvas contract", () => {
  beforeEach(() => {
    useAgentStore.setState({ windows: [], chatMessages: [] });
  });

  it("exposes exactly the eight registry tools in the model prompt", () => {
    const ctx = createToolCtx({ open: null, recentCards: [] }, () => {});
    const names = Object.keys(createAgentTools(ctx));
    expect(names).toEqual([
      "show",
      "close",
      "search",
      "today",
      "ask_user",
      "remember",
      "upsert_entity",
      "save_workflow",
    ]);
    expect(ORCH_SYSTEM).toContain("Never claim success when a tool returned ok:false.");
    expect(names.every((name) => ORCH_SYSTEM.includes(`- ${name}:`))).toBe(true);
    expect(ORCH_SYSTEM.length).toBeLessThanOrEqual(4000);
    expect(ORCH_MAX_STEPS).toBe(4);
  });

  it("passes show focus through the browser and server canvas state", async () => {
    const events: AgentEvent[] = [];
    const ctx = createToolCtx({ open: null, recentCards: [] }, (event) => events.push(event));
    const tools = createAgentTools(ctx);
    await executeTool(tools.show, { kind: "graph", focus: "Linear" });

    expect(events).toContainEqual({
      type: "ui.canvas",
      action: {
        type: "open",
        kind: "graph",
        payload: { focus: "Linear" },
        openedBy: "agent",
      },
    });
    expect(ctx.snapshot).toEqual({
      open: { kind: "graph", focus: "Linear" },
      recentCards: [{ kind: "graph", focus: "Linear" }],
    });
  });

  it("reports an unsuccessful close when nothing is open", async () => {
    const ctx = createToolCtx({ open: null, recentCards: [] }, () => {});
    const result = await executeTool(createAgentTools(ctx).close, {});
    expect(result).toEqual({ ok: false, reason: "nothing open" });
  });

  it("closes the visible canvas without reviving an older card", () => {
    let state: CanvasState = { windows: [] };
    state = applyCanvasAction(state, { type: "open", kind: "graph", at: 1 });
    state = applyCanvasAction(state, { type: "open", kind: "memories", at: 2 });
    state = applyCanvasAction(state, { type: "close" });
    expect(state.windows).toEqual([]);
  });

  it("builds only the compact open and last-five-card snapshot", () => {
    useAgentStore.setState({
      windows: [{
        id: "graph",
        kind: "graph",
        payload: { focus: "Linear", ignored: true },
        openedAt: 1,
      }],
      chatMessages: Array.from({ length: 7 }, (_, index) => ({
        id: `message-${index}`,
        role: "agent" as const,
        text: "",
        ts: index,
        status: "done" as const,
        cards: [{
          id: `card-${index}`,
          kind: index % 2 ? "workflows" as const : "memories" as const,
          payload: { focus: `focus-${index}` },
        }],
      })),
    });
    const snapshot = buildSnapshot();
    expect(Object.keys(snapshot).sort()).toEqual(["open", "recentCards"]);
    expect(snapshot.open).toEqual({ kind: "graph", focus: "Linear" });
    expect(snapshot.recentCards).toHaveLength(5);
    expect(snapshot.recentCards[0]).toEqual({ kind: "memories", focus: "focus-2" });
  });
});
