import { describe, expect, it } from "vitest";
import { matchLocalIntent } from "../../agent-router";

describe("server-side local intent matching", () => {
  it.each([
    ["show me the graph", ["graph"]],
    ["show my memories", ["memories"]],
    ["show people", ["entities"]],
    ["show me workflows", ["workflows"]],
    ["show my skills", ["skills"]],
    ["show integrations", ["integrations"]],
  ])("maps %j to a visible card kind", (query, kinds) => {
    expect(matchLocalIntent(query)).toEqual(kinds);
  });
});
