import { describe, expect, it } from "vitest";
import { detectLeakedToolCall } from "../leaked-tool-call";

describe("detectLeakedToolCall", () => {
  it("recovers a leaked open_window call from streamed text", () => {
    const text = "open_window(kind='graph', focus='Linear')\nmorning. Here is the graph.";
    const out = detectLeakedToolCall(text);
    expect(out?.name).toBe("open_window");
    expect(out?.args).toEqual({ kind: "graph", focus: "Linear" });
    expect(out?.events[0]).toEqual({
      type: "ui.canvas",
      action: {
        type: "open",
        kind: "graph",
        payload: { focus: "Linear" },
        openedBy: "agent",
      },
    });
  });

  it("handles double quotes and extra args", () => {
    const text = 'open_window(kind="workflows", focus="Bug Triage")';
    const out = detectLeakedToolCall(text);
    expect(out?.args).toEqual({ kind: "workflows", focus: "Bug Triage" });
  });

  it("recovers close_window", () => {
    const text = "close_window(kind='graph')";
    const out = detectLeakedToolCall(text);
    expect(out?.name).toBe("close_window");
    expect(out?.events[0]).toEqual({
      type: "ui.canvas",
      action: { type: "close", kind: "graph" },
    });
  });

  it("ignores unknown window kinds", () => {
    expect(detectLeakedToolCall("open_window(kind='bogus_kind')")).toBeNull();
  });

  it("returns null for normal prose", () => {
    expect(detectLeakedToolCall("morning. I found the project graph.")).toBeNull();
  });

  it("returns null when no tool syntax is present even if a tool name appears", () => {
    expect(
      detectLeakedToolCall("the open_window tool is great"),
    ).toBeNull();
  });
});
