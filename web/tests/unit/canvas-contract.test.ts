import { beforeEach, describe, expect, it } from "vitest";
import { applyAgentEvent, type AgentEvent } from "@/lib/agent-client";
import {
  applyCanvasAction,
  type CanvasAction,
  type CanvasState,
} from "@/lib/agent/canvas-reducer";
import { buildSnapshot } from "@/lib/agent/snapshot";
import { createToolCtx, metaTools } from "@/lib/agent/tools";
import { useAgentStore } from "@/lib/store";

const toolOptions = {
  toolCallId: "canvas-contract",
  messages: [],
  abortSignal: new AbortController().signal,
};

async function executeTool(
  tool: unknown,
  input: Record<string, unknown>,
): Promise<unknown> {
  const execute = (tool as {
    execute: (input: Record<string, unknown>, options: typeof toolOptions) => Promise<unknown>;
  }).execute;
  return execute(input, toolOptions);
}

async function runScenario(
  steps: Array<{ tool: string; input: Record<string, unknown> }>,
) {
  useAgentStore.setState({ windows: [], chatMessages: [] });
  const events: AgentEvent[] = [];
  const ctx = createToolCtx(buildSnapshot({ query: "" }), (event) => events.push(event));
  const tools: Record<string, unknown> = metaTools(ctx);
  let applied = 0;

  for (const step of steps) {
    await executeTool(tools[step.tool], step.input);
    for (const event of events.slice(applied)) applyAgentEvent(event);
    applied = events.length;
  }

  const browser = buildSnapshot();
  const comparable = (windows: typeof browser.windows) =>
    windows.map(({ id, kind, payload, focused, openedAt }) => ({
      id,
      kind,
      payload,
      focused,
      openedAt,
    }));
  expect(comparable(browser.windows)).toEqual(comparable(ctx.snapshot.windows));
  expect(browser.focusedId).toBe(ctx.snapshot.focusedId);
  return { browser, ctx, events };
}

describe("shared canvas reducer contract", () => {
  beforeEach(() => {
    useAgentStore.setState({ windows: [], chatMessages: [] });
  });

  it("keeps browser and server snapshots in sync while opening, focusing, and closing cards", async () => {
    const { browser, events } = await runScenario([
      { tool: "open_window", input: { kind: "graph", focus: "Linear" } },
      { tool: "open_window", input: { kind: "memories" } },
      { tool: "focus_window", input: { kind: "graph" } },
      { tool: "close_window", input: { kind: "memories" } },
    ]);

    expect(browser.windows.map((window) => window.kind)).toEqual(["graph"]);
    expect(browser.windows[0].payload).toEqual({ focus: "Linear" });
    expect(events).toContainEqual({
      type: "ui.canvas",
      action: {
        type: "open",
        kind: "graph",
        payload: { focus: "Linear" },
        openedBy: "agent",
      },
    });
  });

  it("opens a focused card and clears the canvas", async () => {
    const { browser, events } = await runScenario([
      { tool: "open_window", input: { kind: "workflows", focus: "Bug Triage" } },
      { tool: "clear_canvas", input: {} },
    ]);

    expect(browser.windows).toEqual([]);
    expect(events).toContainEqual({
      type: "ui.canvas",
      action: { type: "clear" },
    });
  });

  it("deduplicates opens, updates payloads, and moves the card to the top", () => {
    const initial: CanvasState = { windows: [] };
    const graph: CanvasAction = {
      type: "open",
      kind: "graph",
      payload: { focus: "Linear" },
      at: 1,
    };
    const memories: CanvasAction = { type: "open", kind: "memories", at: 2 };
    let state = applyCanvasAction(initial, graph);
    state = applyCanvasAction(state, memories);
    state = applyCanvasAction(state, {
      type: "open",
      kind: "graph",
      payload: { compact: true },
      at: 3,
    });

    expect(state.windows.map((window) => window.kind)).toEqual(["memories", "graph"]);
    expect(state.windows[1]).toMatchObject({
      payload: { focus: "Linear", compact: true },
      openedAt: 3,
    });
  });
});
