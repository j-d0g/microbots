"use client";

import dynamic from "next/dynamic";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ForwardedRef } from "react";
import {
  type GraphController,
  type GraphFilter,
  type GraphLink,
  type GraphNode,
  LAYER_INK,
  LAYER_RING,
} from "./types";

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  { ssr: false },
);

type FGRef = {
  zoomToFit: (
    durationMs?: number,
    padding?: number,
    nodeFilter?: (n: GraphNode) => boolean,
  ) => void;
  zoom: (scale: number, durationMs?: number) => void;
  centerAt: (x: number, y: number, durationMs?: number) => void;
  d3Force: (
    name: string,
    force?:
      | {
          strength?: (s: number) => unknown;
          distance?: (d: number) => unknown;
        }
      | unknown,
  ) => unknown;
  d3ReheatSimulation: () => void;
};

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
  filter: GraphFilter;
  width: number;
  height: number;
  selectedId: string | null;
  highlightId: string | null;
  highlightNeighborIds: Set<string>;
  pathIds: Set<string>;
  onNodeClick: (node: GraphNode) => void;
  onNodeHover: (node: GraphNode | null) => void;
  onBackgroundClick: () => void;
}

function radiusFor(layer: GraphNode["layer"]) {
  switch (layer) {
    case "user":
      return 7;
    case "integration":
      return 5.5;
    case "workflow":
      return 5.5;
    case "entity":
      return 4;
    case "skill":
      return 4;
    default:
      return 3.2;
  }
}

export const GraphCanvas = forwardRef(function GraphCanvas(
  props: Props,
  ref: ForwardedRef<GraphController>,
) {
  const {
    nodes,
    links,
    width,
    height,
    selectedId,
    highlightId,
    highlightNeighborIds,
    pathIds,
    onNodeClick,
    onNodeHover,
    onBackgroundClick,
  } = props;

  const fgRef = useRef<FGRef | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const get = (k: string) => {
      let s = map.get(k);
      if (!s) {
        s = new Set();
        map.set(k, s);
      }
      return s;
    };
    for (const link of links) {
      const s =
        typeof link.source === "string" ? link.source : link.source.id;
      const t =
        typeof link.target === "string" ? link.target : link.target.id;
      get(s).add(t);
      get(t).add(s);
    }
    return map;
  }, [links]);

  const data = useMemo(() => ({ nodes, links }), [nodes, links]);

  /* tune simulation forces for calm spacing */
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge") as
      | { strength: (s: number | ((n: GraphNode) => number)) => unknown }
      | undefined;
    if (charge && typeof charge.strength === "function") {
      charge.strength(-90);
    }
    const link = fg.d3Force("link") as
      | { distance: (d: number | ((l: GraphLink) => number)) => unknown }
      | undefined;
    if (link && typeof link.distance === "function") {
      link.distance(46);
    }
    fg.d3ReheatSimulation();
  }, [data]);

  /* zoom-to-fit when data set changes (filter, etc).
   * Filter to nodes with degree >= 2 so weakly-connected pad-out nodes
   * don't skew the framing. Falls back to all nodes if there aren't enough.
   */
  const fit = useCallback(
    (duration = 440, padding?: number) => {
      const fg = fgRef.current;
      if (!fg) return;
      const p = padding ?? Math.min(64, Math.max(32, Math.round(Math.min(width, height) * 0.06)));
      const main = nodes.filter((n) => (adjacency.get(n.id)?.size ?? 0) >= 2);
      const filterFn = main.length >= 6
        ? (n: GraphNode) => (adjacency.get(n.id)?.size ?? 0) >= 2
        : undefined;
      fg.zoomToFit(duration, p, filterFn);
    },
    [width, height, nodes, adjacency],
  );

  useEffect(() => {
    const t = setTimeout(() => fit(440), 380);
    return () => clearTimeout(t);
  }, [data, width, height, fit]);

  /* expose imperative API to parent */
  useImperativeHandle(
    ref,
    () => ({
      zoomToFit: (duration = 360, padding) => fit(duration, padding),
      zoomTo: (scale, duration = 360) =>
        fgRef.current?.zoom(scale, duration),
      centerAt: (x, y, duration = 360) =>
        fgRef.current?.centerAt(x, y, duration),
      focusNode: (id, duration = 360, scale = 2.4) => {
        const node = nodes.find((n) => n.id === id);
        if (!node || node.x == null || node.y == null) return;
        fgRef.current?.centerAt(node.x, node.y, duration);
        fgRef.current?.zoom(scale, duration);
      },
      selectNode: () => {},
      highlightNode: () => {},
      highlightNeighbors: () => {},
      highlightPath: () => {},
      clearHighlight: () => {},
      setFilter: () => {},
      clearFilters: () => {},
      getViewport: () => null,
      getSelectedNode: () =>
        nodes.find((n) => n.id === selectedId) ?? null,
    }),
    [nodes, selectedId],
  );

  /* canvas painter */
  const drawNode = useCallback(
    (rawNode: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = rawNode as GraphNode;
      if (n.x == null || n.y == null) return;

      const r = radiusFor(n.layer);
      const isSelected = selectedId === n.id;
      const isHover = hoverId === n.id;
      const isHighlight = highlightId === n.id;
      const isNeighbor = highlightNeighborIds.has(n.id);
      const inPath = pathIds.has(n.id);

      // Dim everything when something is highlighted but this node isn't part of it.
      let alpha = 1;
      const hasFocus = highlightId || pathIds.size > 0;
      if (hasFocus && !isHighlight && !isNeighbor && !inPath) alpha = 0.18;

      const fill = isSelected || isHighlight ? "#2E3A8C" : LAYER_INK[n.layer];
      const ring = LAYER_RING[n.layer];

      ctx.save();
      ctx.globalAlpha = alpha;

      // outer halo for selected/highlight
      if (isSelected || isHighlight) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(46,58,140,0.10)";
        ctx.fill();
      }

      // hairline ring for definition on paper background
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 0.5, 0, 2 * Math.PI);
      ctx.strokeStyle = isSelected || isHighlight ? "#2E3A8C" : ring;
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();

      // fill
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();

      // hover ring
      if (isHover && !isSelected && !isHighlight) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(26,26,26,0.35)";
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      // labels: show always for select/hover/highlight, otherwise gated by zoom + degree
      const degree = adjacency.get(n.id)?.size ?? 0;
      const showLabel =
        isSelected ||
        isHover ||
        isHighlight ||
        (globalScale >= 1.8 && degree >= 2) ||
        (globalScale >= 0.9 && degree >= 5) ||
        n.layer === "user" ||
        n.layer === "workflow";

      if (showLabel) {
        const fontSize = Math.max(11 / globalScale, 5.5);
        ctx.font = `${fontSize}px "Inter", system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle =
          isSelected || isHighlight ? "#1A1A1A" : "rgba(91,91,88,0.92)";
        ctx.fillText(n.label, n.x + r + 4, n.y);
      }

      ctx.restore();
    },
    [
      selectedId,
      hoverId,
      highlightId,
      highlightNeighborIds,
      pathIds,
      adjacency,
    ],
  );

  /* link painter — slim hairlines, neighbor highlight on focus */
  const drawLink = useCallback(
    (rawLink: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const l = rawLink as {
        source: GraphNode;
        target: GraphNode;
      };
      const s = l.source;
      const t = l.target;
      if (
        !s ||
        !t ||
        s.x == null ||
        s.y == null ||
        t.x == null ||
        t.y == null
      )
        return;

      const sId = s.id;
      const tId = t.id;
      const hasFocus = highlightId || pathIds.size > 0;
      const onPath = pathIds.has(sId) && pathIds.has(tId);
      const touchesHighlight =
        highlightId &&
        (sId === highlightId ||
          tId === highlightId ||
          (highlightNeighborIds.has(sId) && highlightNeighborIds.has(tId)));

      let stroke = "rgba(180,176,165,0.6)";
      let width = 1 / globalScale;
      let alpha = 1;

      if (hasFocus) {
        if (onPath || touchesHighlight) {
          stroke = "rgba(46,58,140,0.85)";
          width = 1.4 / globalScale;
        } else {
          alpha = 0.15;
        }
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.restore();
    },
    [highlightId, highlightNeighborIds, pathIds],
  );

  return (
    <ForceGraph2D
      ref={fgRef as unknown as never}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      enableNodeDrag={false}
      enableZoomInteraction
      enablePanInteraction
      cooldownTicks={120}
      warmupTicks={60}
      d3AlphaDecay={0.02}
      d3VelocityDecay={0.32}
      minZoom={0.18}
      maxZoom={6}
      nodeRelSize={4}
      onEngineStop={() => fit(440)}
      nodeCanvasObject={drawNode}
      nodePointerAreaPaint={(rawNode, color, ctx) => {
        const n = rawNode as GraphNode;
        if (n.x == null || n.y == null) return;
        const r = radiusFor(n.layer) + 6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        ctx.fill();
      }}
      linkCanvasObject={drawLink}
      linkCanvasObjectMode={() => "replace"}
      onNodeClick={(rawNode) => onNodeClick(rawNode as GraphNode)}
      onNodeHover={(rawNode) => {
        const n = rawNode as GraphNode | null;
        setHoverId(n?.id ?? null);
        onNodeHover(n);
      }}
      onBackgroundClick={onBackgroundClick}
    />
  );
});
