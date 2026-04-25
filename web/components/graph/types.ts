import type { NodeLayer } from "@/lib/seed/types";

export interface GraphNode {
  id: string;
  label: string;
  layer: NodeLayer;
  integration?: string;
  confidence?: number;
  /* runtime — set by force simulation */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation?: string;
}

export interface GraphFilter {
  layer: NodeLayer | null;
  integration: string | null;
  query: string;
}

export interface GraphController {
  /* viewport */
  zoomToFit: (durationMs?: number, padding?: number) => void;
  zoomTo: (scale: number, durationMs?: number) => void;
  centerAt: (x: number, y: number, durationMs?: number) => void;
  focusNode: (id: string, durationMs?: number, scale?: number) => void;
  /* selection + highlight */
  selectNode: (id: string | null) => void;
  highlightNode: (id: string | null) => void;
  highlightNeighbors: (id: string | null) => void;
  highlightPath: (sourceId: string, targetId: string) => void;
  clearHighlight: () => void;
  /* filter */
  setFilter: (filter: Partial<GraphFilter>) => void;
  clearFilters: () => void;
  /* introspection */
  getViewport: () => { x: number; y: number; scale: number } | null;
  getSelectedNode: () => GraphNode | null;
}

export const LAYER_INK: Record<NodeLayer, string> = {
  user: "#1A1A1A",
  integration: "#5B5B58",
  entity: "#2E3A8C",
  memory: "#9C9A93",
  skill: "#3E7D53",
  workflow: "#B8873A",
};

export const LAYER_RING: Record<NodeLayer, string> = {
  user: "#1A1A1A",
  integration: "#5B5B58",
  entity: "#2E3A8C",
  memory: "#5B5B58",
  skill: "#3E7D53",
  workflow: "#B8873A",
};

export const LAYERS_ORDER: NodeLayer[] = [
  "user",
  "integration",
  "entity",
  "memory",
  "skill",
  "workflow",
];
