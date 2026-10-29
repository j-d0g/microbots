import { describe, expect, it } from "vitest";
import { matchLocalIntent } from "../../agent-router";

describe("matchLocalIntent", () => {
  it.each([
    ["show me the graph", ["graph"]],
    ["morning brief", ["memories", "workflows"]],
    ["open the bug triage workflow", ["workflows"]],
    ["anything wrong with my stack?", ["integrations"]],
    ["asdf", []],
  ])("routes %j", (query, rooms) => {
    expect(matchLocalIntent(query)).toEqual(rooms);
  });

  it("matches case-insensitively and preserves keyword group order", () => {
    expect(matchLocalIntent("Workflow then GRAPH")).toEqual([
      "graph",
      "workflows",
    ]);
  });
});
