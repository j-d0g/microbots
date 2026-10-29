import type { NodeLayer } from "@/lib/seed/types";
import type { GraphFilter, GraphLink, GraphNode } from "./types";

export const LABEL_ZOOM = 1.6;

export type Ring = 0 | 1 | 2 | 3;

export interface ViewState {
  filter: GraphFilter;
  focusId: string | null;
  pathIds: Set<string>;
}

export interface GraphView {
  nodes: GraphNode[];
  links: GraphLink[];
  focusSet: Set<string> | null;
  memoryCounts: Map<string, number>;
}

export interface CoUsedEdge {
  source: string;
  target: string;
  weight: number;
}

export interface EdgeStyle {
  dash: number[] | null;
  width: number;
  alpha: number;
  arrow: boolean;
}

export function linkEnds(link: GraphLink): [string, string] {
  return [
    typeof link.source === "string" ? link.source : link.source.id,
    typeof link.target === "string" ? link.target : link.target.id,
  ];
}

export function isLinkDrawn(
  link: GraphLink,
  context: {
    focusId: string | null;
    hoverId: string | null;
    pathIds: Set<string>;
  },
): boolean {
  if (link.relation !== "appears_in") return true;
  const [source, target] = linkEnds(link);
  return (
    source === context.focusId ||
    target === context.focusId ||
    source === context.hoverId ||
    target === context.hoverId ||
    (context.pathIds.has(source) && context.pathIds.has(target))
  );
}

export function buildAdjacency(links: GraphLink[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const link of links) {
    const [source, target] = linkEnds(link);
    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());
    adjacency.get(source)!.add(target);
    adjacency.get(target)!.add(source);
  }
  return adjacency;
}

export function shortestPath(
  adjacency: Map<string, Set<string>>,
  from: string,
  to: string,
): string[] {
  if (from === to) return [from];
  const visited = new Set([from]);
  const previous = new Map<string, string>();
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      previous.set(neighbor, current);
      if (neighbor === to) {
        const path = [to];
        let cursor = current;
        while (cursor !== from) {
          path.push(cursor);
          cursor = previous.get(cursor)!;
        }
        path.push(from);
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return [];
}

export function resolveNodeRef(nodes: GraphNode[], ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const exact = nodes.find((node) => node.id === trimmed);
  if (exact) return exact.id;
  const label = trimmed.toLowerCase();
  const labelMatch = nodes.find(
    (node) => node.label.trim().toLowerCase() === label,
  );
  if (labelMatch) return labelMatch.id;
  const slugId = `int-${label}`;
  return nodes.some((node) => node.id === slugId) ? slugId : null;
}

export function memoryCounts(links: GraphLink[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const link of links) {
    if (link.relation !== "from") continue;
    const [, target] = linkEnds(link);
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

export function ringOf(layer: NodeLayer): number {
  switch (layer) {
    case "user":
      return 0;
    case "integration":
      return 1;
    case "skill":
    case "workflow":
      return 2;
    case "entity":
      return 3;
    case "memory":
      return 1.5;
  }
}

export function ringRadii(nodes: GraphNode[]): Record<NodeLayer, number> {
  const counts = {
    integration: 0,
    skill: 0,
    workflow: 0,
    entity: 0,
  };
  for (const node of nodes) {
    if (node.layer in counts) {
      counts[node.layer as keyof typeof counts] += 1;
    }
  }
  const r1 = Math.max(90, (counts.integration * 40) / (2 * Math.PI));
  const r2 = Math.max(
    r1 + 80,
    ((counts.skill + counts.workflow) * 40) / (2 * Math.PI),
  );
  const r3 = Math.max(r2 + 80, (counts.entity * 32) / (2 * Math.PI));
  return {
    user: 0,
    integration: r1,
    memory: r1 + 40,
    skill: r2,
    workflow: r2,
    entity: r3,
  };
}

export function deriveView(
  graph: { nodes: GraphNode[]; links: GraphLink[] },
  state: ViewState,
): GraphView {
  const { filter, focusId, pathIds } = state;
  const adjacency = buildAdjacency(graph.links);
  const focusSet =
    focusId === null
      ? null
      : new Set([focusId, ...(adjacency.get(focusId) ?? [])]);
  const relatedToIntegration = filter.integration
    ? new Set([
        `int-${filter.integration.toLowerCase()}`,
        ...(adjacency.get(`int-${filter.integration.toLowerCase()}`) ?? []),
      ])
    : null;
  const query = filter.query.trim().toLowerCase();
  const queryMatches = (node: GraphNode) =>
    !!query && node.label.toLowerCase().includes(query);

  const nodes = graph.nodes.filter((node) => {
    if (node.layer === "memory") {
      return (
        filter.layer === "memory" ||
        queryMatches(node) ||
        !!relatedToIntegration?.has(node.id) ||
        !!focusSet?.has(node.id) ||
        pathIds.has(node.id)
      );
    }
    if (filter.layer && node.layer !== filter.layer) return false;
    if (query && !queryMatches(node)) return false;
    if (relatedToIntegration && !relatedToIntegration.has(node.id)) return false;
    return true;
  });
  const visibleIds = new Set(nodes.map((node) => node.id));
  const links = graph.links.filter((link) => {
    if (link.relation === "co_used_with") return false;
    const [source, target] = linkEnds(link);
    return visibleIds.has(source) && visibleIds.has(target);
  });
  return {
    nodes,
    links,
    focusSet,
    memoryCounts: memoryCounts(graph.links),
  };
}

export function coUsedEdges(
  links: GraphLink[],
  integrationId: string | null,
): CoUsedEdge[] {
  if (integrationId === null) return [];
  const edges: CoUsedEdge[] = [];
  for (const link of links) {
    if (link.relation !== "co_used_with") continue;
    const [source, target] = linkEnds(link);
    if (source === integrationId || target === integrationId) {
      edges.push({ source, target, weight: link.weight ?? 1 });
    }
  }
  return edges;
}

export function coUsedWidth(weight: number, maxWeight: number): number {
  return 0.6 + (1.6 * weight) / (maxWeight || 1);
}

export function nodeOpacity(
  id: string,
  view: GraphView,
  pathIds: Set<string>,
): number {
  if (pathIds.size > 0) return pathIds.has(id) ? 1 : 0.1;
  if (view.focusSet) return view.focusSet.has(id) ? 1 : 0.1;
  return 1;
}

export function shouldLabel(
  node: GraphNode,
  ctx: {
    hoverId: string | null;
    focusSet: Set<string> | null;
    pathIds: Set<string>;
    zoom: number;
  },
): boolean {
  return (
    node.layer === "user" ||
    node.layer === "integration" ||
    node.layer === "workflow" ||
    ctx.hoverId === node.id ||
    !!ctx.focusSet?.has(node.id) ||
    ctx.pathIds.has(node.id) ||
    ctx.zoom >= LABEL_ZOOM
  );
}

export function labelText(node: GraphNode, hovered: boolean): string {
  if (hovered || node.label.length <= 28) return node.label;
  const prefix = node.label.slice(0, 27);
  const wordEnd = prefix.lastIndexOf(" ");
  return `${wordEnd > 0 ? prefix.slice(0, wordEnd) : prefix}…`;
}

export function edgeStyle(relation?: string): EdgeStyle {
  if (relation === "uses") return { dash: null, width: 1, alpha: 0.5, arrow: false };
  if (relation?.startsWith("step")) {
    return { dash: [4, 3], width: 1, alpha: 0.55, arrow: true };
  }
  if (relation === "from") {
    return { dash: [1, 2.5], width: 1, alpha: 0.28, arrow: false };
  }
  if (relation === "appears_in") {
    return { dash: null, width: 0.8, alpha: 0.3, arrow: false };
  }
  return { dash: null, width: 1, alpha: 0.4, arrow: false };
}
