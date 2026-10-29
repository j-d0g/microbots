import { beforeEach, describe, expect, it } from "vitest";
import { applyAgentEvent, type AgentEvent } from "@/lib/agent-client";
import {
  applyCanvasAction,
  type CanvasAction,
  type CanvasState,
} from "@/lib/agent/canvas-reducer";
import { buildSnapshot } from "@/lib/agent/snapshot";
import { metaTools, createToolCtx } from "@/lib/agent/tools";
import { windowManagementTools } from "@/lib/agent/window-tools/window-management";
import { useAgentStore } from "@/lib/store";

type Step = { tool: string; input: Record<string, unknown> };

const toolOptions = {
  toolCallId: "contract-test",
  messages: [],
  abortSignal: new AbortController().signal,
};

async function executeTool(tool: unknown, input: Record<string, unknown>) {
  const execute = (tool as {
    execute: (input: Record<string, unknown>, options: typeof toolOptions) => Promise<unknown>;
  }).execute;
  return execute(input, toolOptions);
}

async function runScenario(mode: "windowed" | "chat", steps: Step[]) {
  useAgentStore.setState({
    windows: [],
    uiMode: mode,
    chatRoom: "chat",
    room: "chat",
    recentActions: [],
    canvasT0: 0,
  });
  const snapshot = buildSnapshot({ query: "", viewport: { w: 1440, h: 900 } });
  const events: AgentEvent[] = [];
  const ctx = createToolCtx(snapshot, (event) => events.push(event));
  const tools: Record<string, unknown> = { ...metaTools(ctx), ...windowManagementTools(ctx) };
  let applied = 0;
  let lastResult: unknown;
  for (const step of steps) {
    lastResult = await executeTool(tools[step.tool], step.input);
    for (const event of events.slice(applied)) applyAgentEvent(event);
    applied = events.length;
  }
  const browser = buildSnapshot({ viewport: { w: 1440, h: 900 } });
  const fields = (windows: typeof browser.windows) =>
    windows.map(({ id, kind, mount, rect, zIndex, focused }) => ({
      id,
      kind,
      mount,
      rect,
      zIndex,
      focused,
    }));
  expect(fields(browser.windows)).toEqual(fields(ctx.snapshot.windows));
  expect(browser.focusedId).toBe(ctx.snapshot.focusedId);
  return { browser, ctx, events, lastResult };
}

describe("shared canvas reducer contract", () => {
  beforeEach(() => {
    useAgentStore.setState({
      windows: [],
      uiMode: "windowed",
      chatRoom: "chat",
      room: "chat",
      recentActions: [],
      canvasT0: 0,
    });
  });

  it("keeps reducer and store mirrors in sync across windowed operations", async () => {
    await runScenario("windowed", [
      { tool: "open_window", input: { kind: "graph", mount: "full" } },
    ]);
    await runScenario("windowed", [
      { tool: "open_window", input: { kind: "memories", mount: "full" } },
      { tool: "open_window", input: { kind: "workflows", mount: "full" } },
      { tool: "arrange_windows", input: { layout: "split" } },
      { tool: "arrange_windows", input: { layout: "grid" } },
    ]);
    await runScenario("windowed", [
      { tool: "open_window", input: { kind: "memories", mount: "full" } },
      { tool: "open_window", input: { kind: "workflows", mount: "full" } },
      { tool: "close_window", input: { kind: "memories" } },
    ]);
    const noMatch = await runScenario("windowed", [
      { tool: "close_window", input: { kind: "settings" } },
    ]);
    expect(noMatch.events.some((event) => event.type === "ui.canvas")).toBe(false);
    expect(noMatch.events).toContainEqual({
      type: "agent.tool.done",
      name: "close_window",
      ok: false,
    });
    expect(noMatch.lastResult).toBe("No window matched the close request.");
    await runScenario("windowed", [
      { tool: "open_window", input: { kind: "memories", mount: "full" } },
      { tool: "open_window", input: { kind: "workflows", mount: "full" } },
      { tool: "open_window", input: { kind: "graph", mount: "full" } },
      { tool: "focus_window", input: { kind: "memories" } },
    ]);
    await runScenario("windowed", [
      { tool: "open_window", input: { kind: "graph", mount: "full" } },
      { tool: "clear_canvas", input: {} },
    ]);
    const { browser } = await runScenario("windowed", [
      { tool: "open_window", input: { kind: "graph", mount: "full" } },
      { tool: "open_window", input: { kind: "memories", mount: "full" } },
      { tool: "winman_bring_to_front", input: { kind: "graph" } },
    ]);
    expect(browser.focusedId).toBe("win-graph");
    const pipMoved = await runScenario("windowed", [
      { tool: "open_window", input: { kind: "memories", mount: "full" } },
      { tool: "open_window", input: { kind: "workflows", mount: "full" } },
      { tool: "winman_minimize_window", input: { kind: "workflows" } },
    ]);
    expect(pipMoved.browser.windows.find((window) => window.kind === "workflows")?.mount)
      .toBe("pip-br");

    const closed = await runScenario("windowed", [
      { tool: "open_window", input: { kind: "memories", mount: "full" } },
      { tool: "open_window", input: { kind: "workflows", mount: "full" } },
      { tool: "winman_minimize_window", input: { kind: "workflows" } },
      {
        tool: "winman_close_all_except",
        input: { keep_ids: ["win-memories"] },
      },
    ]);
    expect(closed.browser.windows.map((window) => window.id)).toEqual(["win-memories"]);
  });

  it("keeps only the focal window in chat mode and ignores arrange", async () => {
    const { browser } = await runScenario("chat", [
      { tool: "open_window", input: { kind: "graph", mount: "full" } },
      { tool: "open_window", input: { kind: "memories", mount: "full" } },
      { tool: "arrange_windows", input: { layout: "split" } },
    ]);
    expect(browser.windows.map((window) => window.kind)).toEqual(["memories"]);
    expect(useAgentStore.getState().chatRoom).toBe("memories");
  });

  it("deduplicates opens and keeps only the top window when entering chat mode", () => {
    const initial: CanvasState = {
      windows: [],
      mode: "windowed",
      viewport: { w: 1440, h: 900 },
    };
    const open: CanvasAction = { type: "open", kind: "graph", at: 1 };
    const one = applyCanvasAction(initial, open);
    const duplicate = applyCanvasAction(one, { ...open, payload: { query: "latest" } });
    expect(duplicate.windows).toHaveLength(1);
    expect(duplicate.windows[0].payload).toEqual({ query: "latest" });
    const two = applyCanvasAction(duplicate, { type: "open", kind: "memories", at: 2 });
    const chat = applyCanvasAction(two, { type: "set_mode", mode: "chat" });
    expect(chat.windows.map((window) => window.kind)).toEqual(["memories"]);
  });

  it("preserves a window's rect on reopen unless a mount is supplied", () => {
    const initial: CanvasState = {
      windows: [],
      mode: "windowed",
      viewport: { w: 1440, h: 900 },
    };
    const opened = applyCanvasAction(initial, {
      type: "open",
      kind: "graph",
      mount: "left-half",
    });
    const rect = { x: 12, y: 18, w: 42, h: 56 };
    const positioned = applyCanvasAction(opened, {
      type: "set_rect",
      id: "win-graph",
      rect,
    });

    const reopened = applyCanvasAction(positioned, {
      type: "open",
      kind: "graph",
    });
    expect(reopened.windows[0].rect).toEqual(rect);
    expect(reopened.windows[0].mount).toBe("freeform");

    const remounted = applyCanvasAction(reopened, {
      type: "open",
      kind: "graph",
      mount: "right-half",
    });
    expect(remounted.windows[0].mount).toBe("right-half");
    expect(remounted.windows[0].rect).not.toEqual(rect);
  });
});
