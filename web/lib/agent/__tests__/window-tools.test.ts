import { describe, expect, it } from "vitest";
import type { AgentToolCtx } from "../tools";
import { WINDOW_TOOL_FACTORIES } from "../window-tools";

const expectedKinds = [
  "ask_user",
  "composio_connect",
  "entities",
  "entity_detail",
  "graph",
  "integration_detail",
  "integrations",
  "memories",
  "skills",
  "workflows",
];

function mockContext(): AgentToolCtx {
  return {
    snapshot: {
      focusedId: null,
      windows: [],
      user: { query: "" },
    },
    emit: () => undefined,
  };
}

describe("window tool registry", () => {
  it("has one factory for every supported canvas kind", () => {
    expect(Object.keys(WINDOW_TOOL_FACTORIES).sort()).toEqual(expectedKinds);
  });

  it("builds callable tools for each supported canvas kind", () => {
    for (const [kind, factory] of Object.entries(WINDOW_TOOL_FACTORIES)) {
      const tools = factory(mockContext());
      expect(Object.keys(tools), `${kind} should expose tools`).not.toHaveLength(0);
      for (const [name, candidate] of Object.entries(tools)) {
        expect(candidate, `${kind}.${name}`).toHaveProperty("inputSchema");
        expect(candidate, `${kind}.${name}`).toHaveProperty("execute");
      }
    }
  });
});
