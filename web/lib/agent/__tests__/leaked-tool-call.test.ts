import { describe, expect, it } from "vitest";
import { detectLeakedToolCall } from "../leaked-tool-call";

describe("detectLeakedToolCall", () => {
  it("recovers a leaked open_window(kind='profile') from streamed text", () => {
    const text = "open_window(kind='profile')\nmorning. let me pull up your profile.";
    const out = detectLeakedToolCall(text);
    expect(out?.name).toBe("open_window");
    expect(out?.args.kind).toBe("profile");
    expect(out?.events[0]).toEqual({ type: "ui.room", room: "profile" });
  });

  it("handles double quotes and extra args", () => {
    const text = 'open_window(kind="workflows", mount="full")';
    const out = detectLeakedToolCall(text);
    expect(out?.args.kind).toBe("workflows");
  });

  it("recovers close_window", () => {
    const text = "close_window(kind='graph')";
    const out = detectLeakedToolCall(text);
    expect(out?.name).toBe("close_window");
    expect(out?.events[0]).toEqual({ type: "ui.close_window", room: "graph" });
  });

  it("ignores unknown window kinds", () => {
    expect(detectLeakedToolCall("open_window(kind='bogus_kind')")).toBeNull();
  });

  it("returns null for normal prose", () => {
    expect(detectLeakedToolCall("morning. opened the wiki for you.")).toBeNull();
  });

  it("returns null when no tool syntax is present even if a tool name appears", () => {
    expect(
      detectLeakedToolCall("the open_window tool is great"),
    ).toBeNull();
  });
});
