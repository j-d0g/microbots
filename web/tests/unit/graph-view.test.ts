import { describe, expect, it } from "vitest";

import { toGraph } from "@/lib/api/kg-to-graph";
import type { KgBundle } from "@/lib/api/kg-to-graph";
import {
  coUsedEdges,
  coUsedWidth,
  deriveView,
  edgeStyle,
  isLinkDrawn,
  LABEL_PRIORITY,
  labelText,
  memoryCounts,
  nodeOpacity,
  pickLabels,
  resolveNodeRef,
  ringOf,
  ringRadii,
  shouldLabel,
  shortestPath,
} from "@/components/graph/graph-view";

function fixture() {
  const bundle: KgBundle = {
    user: {
      id: "user:alice",
      name: "Alice",
      role: "engineer",
      goals: [],
      preferences: {},
      context_window: 8192,
      created_at: "",
      updated_at: "",
      chat_count: 0,
      memory_count: 0,
      entity_count: 1,
      skill_count: 1,
      workflow_count: 1,
      integration_count: 2,
    },
    integrations: [
      {
        slug: "linear",
        name: "Linear",
        co_used_with_slugs: [{ out: { slug: "github" }, frequency: 3 }],
      },
      { slug: "github", name: "GitHub" },
    ],
    entities: [
      {
        id: "entity:alice",
        name: "Alice",
        entity_type: "person",
        integration_slugs: ["linear"],
      },
    ],
    memories: [
      {
        id: "memory:linear",
        content: "Alice prefers Linear for planning.",
        memory_type: "preference",
        confidence: 0.9,
        source: "linear",
        integration_slugs: ["linear"],
      },
      {
        id: "memory:github",
        content: "Alice reviews code in GitHub.",
        memory_type: "fact",
        confidence: 0.8,
        integration_slugs: ["github"],
      },
    ],
    skills: [
      {
        id: "skill:triage_incoming_bug",
        slug: "triage_incoming_bug",
        name: "Triage incoming bug",
        description: "",
        steps: [],
        strength: 1,
        integrations: ["linear"],
      },
    ],
    workflows: [
      {
        id: "workflow:bug_triage",
        slug: "bug_triage",
        name: "Bug triage",
        description: "",
        tags: [],
        skill_chain: [{ skill_slug: "triage_incoming_bug", step_order: 1 }],
      },
    ],
    connections: [],
  };
  return toGraph(bundle);
}

describe("graph view helpers", () => {
  it("hides memories and co-used links in the overview", () => {
    const graph = fixture();
    const view = deriveView(graph, {
      filter: { layer: null, integration: null, query: "" },
      focusId: null,
      pathIds: new Set(),
    });
    expect(view.nodes.some((node) => node.layer === "memory")).toBe(false);
    expect(view.links.some((link) => link.relation === "co_used_with")).toBe(
      false,
    );
  });

  it("counts memory links for each integration", () => {
    expect(memoryCounts(fixture().links)).toEqual(
      new Map([
        ["int-linear", 1],
        ["int-github", 1],
      ]),
    );
  });

  it("connects entities and memories to their integrations", () => {
    const graph = fixture();
    expect(graph.links).toContainEqual({
      source: "entity:alice",
      target: "int-linear",
      relation: "appears_in",
    });
    expect(
      graph.links.filter(
        (link) => link.source === "memory:linear" && link.relation === "from",
      ),
    ).toHaveLength(1);
    expect(graph.nodes.find((node) => node.id === "memory:linear")?.integration)
      .toBe("linear");

    const sourceOnlyGraph = toGraph({
      user: null,
      integrations: [
        { slug: "linear", name: "Linear" },
        { slug: "github", name: "GitHub" },
      ],
      entities: [],
      memories: [
        {
          id: "memory:both",
          content: "A linked memory.",
          memory_type: "fact",
          confidence: 0.8,
          source: "github",
          integration_slugs: ["linear"],
        },
      ],
      skills: [],
      workflows: [],
      connections: [],
    });
    expect(
      sourceOnlyGraph.links.filter(
        (link) => link.source === "memory:both" && link.relation === "from",
      ),
    ).toEqual([
      { source: "memory:both", target: "int-linear", relation: "from" },
      { source: "memory:both", target: "int-github", relation: "from" },
    ]);
    expect(
      sourceOnlyGraph.nodes.find((node) => node.id === "memory:both")
        ?.integration,
    ).toBe("linear");
  });

  it("includes a focused integration and its one-hop neighbors and memories", () => {
    const graph = fixture();
    const view = deriveView(graph, {
      filter: { layer: null, integration: null, query: "" },
      focusId: "int-linear",
      pathIds: new Set(),
    });
    expect(view.focusSet).toEqual(
      new Set([
        "int-linear",
        "int-github",
        "user-self",
        "entity:alice",
        "memory:linear",
        "skill:triage_incoming_bug",
        "workflow:bug_triage",
      ]),
    );
    expect(view.nodes.map((node) => node.id)).toContain("memory:linear");
  });

  it("shows all memories with the memory layer filter", () => {
    const view = deriveView(fixture(), {
      filter: { layer: "memory", integration: null, query: "" },
      focusId: null,
      pathIds: new Set(),
    });
    expect(view.nodes.map((node) => node.id)).toEqual([
      "memory:linear",
      "memory:github",
    ]);
  });

  it("filters an integration to the integration and its one-hop neighbors", () => {
    const view = deriveView(fixture(), {
      filter: { layer: null, integration: "linear", query: "" },
      focusId: null,
      pathIds: new Set(),
    });
    expect(view.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "int-linear",
        "int-github",
        "user-self",
        "entity:alice",
        "memory:linear",
        "skill:triage_incoming_bug",
        "workflow:bug_triage",
      ]),
    );
    expect(view.nodes.map((node) => node.id)).toContain("workflow:bug_triage");
  });

  it("returns co-used edges with weights and scales their widths", () => {
    const graph = fixture();
    expect(coUsedEdges(graph.links, "int-linear")).toEqual([
      { source: "int-linear", target: "int-github", weight: 3 },
    ]);
    expect(coUsedEdges(graph.links, null)).toEqual([]);
    expect(coUsedWidth(0, 0)).toBe(0.6);
    expect(coUsedWidth(5, 5)).toBe(2.2);
  });

  it("labels always-visible layers, hovered/focused/path nodes, and zoomed nodes", () => {
    const nodes = fixture().nodes;
    const entity = nodes.find((node) => node.id === "entity:alice")!;
    const memory = nodes.find((node) => node.layer === "memory")!;
    const user = nodes.find((node) => node.layer === "user")!;
    const integration = nodes.find((node) => node.id === "int-linear")!;
    const workflow = nodes.find((node) => node.id === "workflow:bug_triage")!;
    const base = {
      hoverId: null,
      focusId: null,
      focusSet: null,
      pathIds: new Set<string>(),
      zoom: 1,
    };
    expect(shouldLabel(user, base)).toBe(true);
    expect(shouldLabel(integration, base)).toBe(true);
    expect(shouldLabel(workflow, base)).toBe(true);
    expect(shouldLabel(entity, base)).toBe(false);
    expect(shouldLabel(entity, { ...base, hoverId: entity.id })).toBe(true);
    expect(
      shouldLabel(entity, { ...base, focusSet: new Set([entity.id]) }),
    ).toBe(true);
    expect(shouldLabel(entity, { ...base, zoom: 1.6 })).toBe(true);
    const focusedView = {
      ...base,
      focusId: "int-linear",
      focusSet: new Set([memory.id]),
      zoom: 3,
    };
    expect(shouldLabel(memory, focusedView)).toBe(false);
    expect(shouldLabel(memory, { ...focusedView, hoverId: memory.id })).toBe(
      true,
    );
    expect(shouldLabel(memory, { ...focusedView, focusId: memory.id })).toBe(
      true,
    );
  });

  it("resolves overlapping labels by priority", () => {
    const labels = pickLabels([
      { id: "memory", x: 0, y: 0, w: 40, h: 12, priority: LABEL_PRIORITY.memory },
      { id: "integration", x: 0, y: 0, w: 40, h: 12, priority: LABEL_PRIORITY.integration },
    ]);

    expect([...labels]).toEqual(["integration"]);
  });

  it("always keeps focused and hovered labels", () => {
    const labels = pickLabels([
      { id: "focus", x: 0, y: 0, w: 40, h: 12, priority: LABEL_PRIORITY.focused },
      { id: "hover", x: 0, y: 0, w: 40, h: 12, priority: LABEL_PRIORITY.hovered },
      { id: "user", x: 0, y: 0, w: 40, h: 12, priority: LABEL_PRIORITY.user },
    ]);

    expect([...labels]).toEqual(["focus", "hover"]);
  });

  it("keeps every non-overlapping label", () => {
    const labels = pickLabels([
      { id: "left", x: 0, y: 0, w: 20, h: 10, priority: LABEL_PRIORITY.entity },
      { id: "middle", x: 30, y: 0, w: 20, h: 10, priority: LABEL_PRIORITY.integration },
      { id: "right", x: 60, y: 0, w: 20, h: 10, priority: LABEL_PRIORITY.memory },
    ]);

    expect(labels).toEqual(new Set(["middle", "left", "right"]));
  });

  it("orders equal-priority labels by id regardless of input order", () => {
    const candidates = [
      { id: "beta", x: 0, y: 0, w: 10, h: 10, priority: LABEL_PRIORITY.entity },
      { id: "alpha", x: 20, y: 0, w: 10, h: 10, priority: LABEL_PRIORITY.entity },
    ];

    expect([...pickLabels(candidates)]).toEqual(["alpha", "beta"]);
    expect([...pickLabels([...candidates].reverse())]).toEqual(["alpha", "beta"]);
  });

  it("only draws appears_in edges near focus, hover, or a complete path", () => {
    const link = fixture().links.find(
      (candidate) => candidate.relation === "appears_in",
    )!;
    const none = { focusId: null, hoverId: null, pathIds: new Set<string>() };

    expect(isLinkDrawn(link, none)).toBe(false);
    expect(isLinkDrawn(link, { ...none, focusId: "entity:alice" })).toBe(true);
    expect(isLinkDrawn(link, { ...none, hoverId: "int-linear" })).toBe(true);
    expect(
      isLinkDrawn(link, {
        ...none,
        pathIds: new Set(["entity:alice", "int-linear"]),
      }),
    ).toBe(true);
    expect(
      isLinkDrawn(link, { ...none, pathIds: new Set(["entity:alice"]) }),
    ).toBe(false);
    expect(isLinkDrawn({ ...link, relation: "uses" }, none)).toBe(true);
  });

  it("truncates non-hovered labels at 28 characters", () => {
    const node = {
      ...fixture().nodes[0],
      label: "User always creates a Linear ticket before opening a GitHub PR",
    };
    expect(labelText(node, false)).toBe("User always creates a…");
    expect(labelText(node, false).length).toBeLessThanOrEqual(28);
    expect(labelText(node, true)).toBe(node.label);
    expect(labelText({ ...node, label: "Linear" }, false)).toBe("Linear");
  });

  it("resolves node ids, case-insensitive labels, and integration slugs", () => {
    const nodes = fixture().nodes;
    expect(resolveNodeRef(nodes, " int-linear ")).toBe("int-linear");
    expect(resolveNodeRef(nodes, "linear")).toBe("int-linear");
    expect(resolveNodeRef(nodes, "LINEAR")).toBe("int-linear");
    expect(resolveNodeRef(nodes, "unknown")).toBeNull();
  });

  it("styles directed, memory, integration, and default edges", () => {
    expect(edgeStyle("uses")).toEqual({
      dash: null,
      width: 1,
      alpha: 0.5,
      arrow: false,
    });
    expect(edgeStyle("step 2")).toEqual({
      dash: [4, 3],
      width: 1,
      alpha: 0.55,
      arrow: true,
    });
    expect(edgeStyle("from")).toEqual({
      dash: [1, 2.5],
      width: 1,
      alpha: 0.28,
      arrow: false,
    });
  });

  it("dims nodes outside the current path or focus set", () => {
    const graph = fixture();
    const overview = deriveView(graph, {
      filter: { layer: null, integration: null, query: "" },
      focusId: null,
      pathIds: new Set(),
    });
    expect(nodeOpacity("entity:alice", overview, new Set())).toBe(1);

    const focused = deriveView(graph, {
      filter: { layer: null, integration: null, query: "" },
      focusId: "int-linear",
      pathIds: new Set(),
    });
    expect(nodeOpacity("entity:alice", focused, new Set())).toBe(1);
    expect(nodeOpacity("workflow:bug_triage", focused, new Set())).toBe(1);
    expect(
      nodeOpacity(
        "workflow:bug_triage",
        focused,
        new Set(["workflow:bug_triage"]),
      ),
    ).toBe(1);
  });

  it("preserves original node identity and finds shortest paths", () => {
    const graph = fixture();
    const view = deriveView(graph, {
      filter: { layer: null, integration: null, query: "" },
      focusId: null,
      pathIds: new Set(),
    });
    expect(view.nodes[0]).toBe(graph.nodes[0]);
    expect(
      shortestPath(
        new Map([
          ["a", new Set(["b"])],
          ["b", new Set(["a", "c"])],
          ["c", new Set(["b"])],
        ]),
        "a",
        "c",
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("places layers on their prescribed rings", () => {
    const nodes = fixture().nodes;
    const radii = ringRadii(nodes);
    expect(ringOf("memory")).toBe(1.5);
    expect(ringOf("entity")).toBe(3);
    expect(radii.user).toBe(0);
    expect(radii.integration).toBe(90);
    expect(radii.memory).toBe(130);
    expect(radii.workflow).toBe(radii.skill);
  });
});
