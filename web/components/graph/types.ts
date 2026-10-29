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
  fx?: number;
  fy?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation?: string;
  weight?: number;
}

export interface GraphFilter {
  layer: NodeLayer | null;
  integration: string | null;
  query: string;
}

export interface GraphController {
  fit: (ids?: Set<string>, durationMs?: number) => void;
  zoomTo: (scale: number, durationMs?: number) => void;
  zoomBy: (factor: number, durationMs?: number) => void;
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
