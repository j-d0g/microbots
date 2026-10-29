import type { ToolDef } from "@/lib/room-tools";
import type { NodeLayer } from "@/lib/seed/types";

export interface GraphRoomOps {
  resolve: (ref: string) => string | null;
  focusNode: (id: string | null, fit: boolean) => void;
  path: (from: string, to: string) => void;
  clear: () => void;
  filterLayer: (layer: NodeLayer | null) => void;
  filterIntegration: (integration: string | null) => void;
  search: (query: string) => void;
  zoomFit: () => void;
  zoomTo: (scale: number) => void;
}

export function graphRoomTools(ops: GraphRoomOps): ToolDef[] {
  const resolved = (value: unknown) =>
    typeof value === "string" ? ops.resolve(value) : null;
  return [
    {
      name: "focus_node",
      description:
        "Center and zoom to a node. Accepts a node id or exact case-insensitive label.",
      args: {
        node_id:
          "node id ('int-linear', 'skill:triage_incoming_bug', 'workflow:bug_triage', 'entity:alice') or a label like 'Linear'",
      },
      run: (args) => {
        const id = resolved(args.node_id);
        if (id) ops.focusNode(id, true);
      },
    },
    {
      name: "zoom_fit",
      description:
        "Reset the graph viewport to fit all currently visible nodes with breathing room.",
      run: () => ops.zoomFit(),
    },
    {
      name: "zoom_to",
      description: "Set graph zoom level. Range 0.2 (far) to 4 (close).",
      args: { scale: "number 0.2..4" },
      run: (args) => {
        const scale = Number(args.scale);
        if (Number.isFinite(scale)) ops.zoomTo(scale);
      },
    },
    {
      name: "highlight",
      description:
        "Highlight a node and its direct neighbors without changing zoom. Empty string clears focus.",
      args: { node_id: "node id or exact case-insensitive label; empty clears" },
      run: (args) => {
        if (args.node_id === "") {
          ops.focusNode(null, false);
          return;
        }
        const id = resolved(args.node_id);
        if (id) ops.focusNode(id, false);
      },
    },
    {
      name: "neighbors",
      description:
        "Highlight a node and its direct neighbors without changing zoom.",
      args: { node_id: "node id or exact case-insensitive label" },
      run: (args) => {
        const id = resolved(args.node_id);
        if (id) ops.focusNode(id, false);
      },
    },
    {
      name: "path",
      description:
        "Highlight the shortest path between two nodes. Accepts node ids or exact case-insensitive labels.",
      args: {
        from: "source node id or label",
        to: "target node id or label",
      },
      run: (args) => {
        const from = resolved(args.from);
        const to = resolved(args.to);
        if (from && to) ops.path(from, to);
      },
    },
    {
      name: "select",
      description:
        "Open the node inspector for a node. Accepts a node id or exact case-insensitive label; empty clears focus.",
      args: { node_id: "node id or exact case-insensitive label; empty clears" },
      run: (args) => {
        if (args.node_id === "") {
          ops.focusNode(null, false);
          return;
        }
        const id = resolved(args.node_id);
        if (id) ops.focusNode(id, true);
      },
    },
    {
      name: "filter_layer",
      description:
        "Filter nodes to a single layer. Pass null/all to clear. Layers: user, integration, entity, memory, skill, workflow.",
      args: { layer: "layer name or null/all" },
      run: (args) => {
        const layer = args.layer;
        if (layer == null || layer === "all") ops.filterLayer(null);
        else ops.filterLayer(String(layer) as NodeLayer);
      },
    },
    {
      name: "filter_integration",
      description:
        "Filter nodes related to one integration. Accepts an integration slug, node id, or label.",
      args: { integration: "integration slug, node id, or label; empty clears" },
      run: (args) => {
        if (args.integration === "" || args.integration == null) {
          ops.filterIntegration(null);
          return;
        }
        const id = resolved(args.integration);
        if (id?.startsWith("int-")) ops.filterIntegration(id.slice(4));
      },
    },
    {
      name: "search",
      description: "Filter nodes by a label substring. Empty string clears.",
      args: { query: "substring" },
      run: (args) => ops.search(String(args.query ?? "")),
    },
    {
      name: "clear",
      description:
        "Reset filters, focus, and paths. Returns the graph to its calm full view.",
      run: () => ops.clear(),
    },
  ];
}
