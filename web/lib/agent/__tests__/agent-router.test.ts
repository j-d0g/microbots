import { describe, expect, it } from "vitest";
import { matchLocalIntent, routeIntent } from "../../agent-router";

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

  it("uses the short local-mode reply when no room matches", async () => {
    const events = [];
    for await (const event of routeIntent("asdf")) events.push(event);
    expect(events).toContainEqual({
      type: "reply.chunk",
      text: "local mode — try: graph, memories, workflows, skills, wiki, integrations",
    });
  });
});
