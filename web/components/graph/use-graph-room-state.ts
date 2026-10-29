"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAdjacency,
  coUsedEdges,
  deriveView,
  resolveNodeRef,
  shortestPath,
} from "./graph-view";
import {
  graphRoomTools,
  type GraphRoomOps,
} from "./graph-room-tools";
import type { GraphController, GraphFilter, GraphLink, GraphNode } from "./types";
import type { NodeLayer } from "@/lib/seed/types";
import { registerTools } from "@/lib/room-tools";

const DEFAULT_FILTER: GraphFilter = {
  layer: null,
  integration: null,
  query: "",
};

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface ControllerRef {
  current: GraphController | null;
}

export function useGraphRoomState(
  graph: GraphData,
  payloadFocus: string | undefined,
  controllerRef: ControllerRef,
) {
  const [filter, setFilter] = useState<GraphFilter>(DEFAULT_FILTER);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pathIds, setPathIds] = useState<Set<string>>(new Set());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [fitOnFocusChange, setFitOnFocusChange] = useState(true);
  const lastPayloadFocus = useRef<string | undefined>(undefined);
  const lastAppliedPayloadFocus = useRef<string | null>(null);

  const view = useMemo(
    () => deriveView(graph, { filter, focusId, pathIds }),
    [graph, filter, focusId, pathIds],
  );
  const adjacency = useMemo(() => buildAdjacency(graph.links), [graph.links]);

  useEffect(() => {
    if (lastPayloadFocus.current !== payloadFocus) {
      lastPayloadFocus.current = payloadFocus;
      lastAppliedPayloadFocus.current = null;
    }
    if (!payloadFocus || lastAppliedPayloadFocus.current === payloadFocus) {
      return;
    }
    const resolved = resolveNodeRef(graph.nodes, payloadFocus);
    if (!resolved) return;
    lastAppliedPayloadFocus.current = payloadFocus;
    startTransition(() => {
      setFilter(DEFAULT_FILTER);
      setPathIds(new Set());
      setFocusId(resolved);
      setFitOnFocusChange(true);
    });
  }, [payloadFocus, graph.nodes]);

  const operations = useMemo<GraphRoomOps>(
    () => ({
      resolve: (ref) => resolveNodeRef(graph.nodes, ref),
      focusNode: (id, shouldFit = true) => {
        setPathIds(new Set());
        setFocusId(id);
        setFitOnFocusChange(shouldFit);
        if (id && shouldFit) {
          controllerRef.current?.fit(
            new Set([id, ...(adjacency.get(id) ?? [])]),
            360,
          );
        }
      },
      path: (from, to) => {
        const path = shortestPath(adjacency, from, to);
        if (path.length === 0) return;
        setPathIds(new Set(path));
        setFocusId(null);
        setFitOnFocusChange(true);
      },
      clear: () => {
        setFocusId(null);
        setPathIds(new Set());
        setFilter(DEFAULT_FILTER);
        setFitOnFocusChange(true);
      },
      filterLayer: (layer: NodeLayer | null) =>
        setFilter((current) => ({ ...current, layer })),
      filterIntegration: (integration) =>
        setFilter((current) => ({ ...current, integration })),
      search: (query) => setFilter((current) => ({ ...current, query })),
      zoomFit: () =>
        controllerRef.current?.fit(
          focusId
            ? new Set([focusId, ...(adjacency.get(focusId) ?? [])])
            : undefined,
          380,
        ),
      zoomTo: (scale) => controllerRef.current?.zoomTo(scale, 280),
    }),
    [adjacency, controllerRef, focusId, graph.nodes],
  );

  const graphOps = useMemo(() => {
    const resolve = (ref: string | null) =>
      ref ? operations.resolve(ref) : null;
    return {
      focusNode: (ref: string | null) =>
        operations.focusNode(resolve(ref), true),
      zoomFit: operations.zoomFit,
      zoomTo: operations.zoomTo,
      selectNode: (ref: string | null) =>
        operations.focusNode(resolve(ref), true),
      highlight: (ref: string | null) =>
        operations.focusNode(resolve(ref), false),
      neighbors: (ref: string | null) =>
        operations.focusNode(resolve(ref), false),
      path: (from: string, to: string) => {
        const resolvedFrom = resolve(from);
        const resolvedTo = resolve(to);
        if (resolvedFrom && resolvedTo) {
          operations.path(resolvedFrom, resolvedTo);
        }
      },
      clear: operations.clear,
      filterLayer: operations.filterLayer,
      filterIntegration: (ref: string | null) => {
        if (!ref) {
          operations.filterIntegration(null);
          return;
        }
        const id = resolve(ref);
        if (id?.startsWith("int-")) {
          operations.filterIntegration(id.slice(4));
        }
      },
      search: operations.search,
    };
  }, [operations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __graph?: typeof graphOps }).__graph = graphOps;
  }, [graphOps]);

  useEffect(
    () => registerTools("graph", graphRoomTools(operations)),
    [operations],
  );

  const focusedNode = useMemo(
    () => graph.nodes.find((node) => node.id === focusId) ?? null,
    [graph.nodes, focusId],
  );
  const hoveredNode = graph.nodes.find((node) => node.id === hoverId);
  const coUsedIntegration =
    hoveredNode?.layer === "integration"
      ? hoverId
      : focusedNode?.layer === "integration"
        ? focusId
        : null;
  const coUsed = useMemo(
    () => coUsedEdges(graph.links, coUsedIntegration),
    [graph.links, coUsedIntegration],
  );
  const hasFocus =
    !!focusId ||
    pathIds.size > 0 ||
    !!filter.layer ||
    !!filter.integration ||
    !!filter.query;

  return {
    filter,
    setFilter,
    focusId,
    setFocusId,
    pathIds,
    setPathIds,
    hoverId,
    setHoverId,
    fitOnFocusChange,
    setFitOnFocusChange,
    view,
    focusedNode,
    coUsed,
    hasFocus,
    clearView: operations.clear,
  };
}
