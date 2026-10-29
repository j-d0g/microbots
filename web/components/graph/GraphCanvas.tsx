"use client";

import dynamic from "next/dynamic";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { ForwardedRef } from "react";
import { forceCollide, forceRadial } from "d3-force-3d";
import {
  coUsedWidth,
  edgeStyle,
  linkEnds,
  nodeOpacity,
  ringRadii,
  shouldLabel,
} from "./graph-view";
import type { CoUsedEdge, GraphView } from "./graph-view";
import type { GraphController, GraphLink, GraphNode } from "./types";
import { LAYER_INK, LAYER_RING } from "./types";

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((module) => module.default),
  { ssr: false },
);

type FGRef = {
  zoomToFit: (
    durationMs?: number,
    padding?: number,
    nodeFilter?: (node: GraphNode) => boolean,
  ) => void;
  zoom: (scale?: number, durationMs?: number) => number | void;
  d3Force: (name: string, force?: unknown) => unknown;
  d3ReheatSimulation: () => void;
};

interface Props {
  view: GraphView;
  pathIds: Set<string>;
  hoverId: string | null;
  onHover: (node: GraphNode | null) => void;
  focusId: string | null;
  fitOnFocusChange: boolean;
  width: number;
  height: number;
  onNodeClick: (node: GraphNode) => void;
  onBackgroundClick: () => void;
  compact: boolean;
  coUsed: CoUsedEdge[];
}

function radiusFor(layer: GraphNode["layer"]) {
  switch (layer) {
    case "user":
      return 7;
    case "integration":
    case "workflow":
      return 5.5;
    case "entity":
    case "skill":
      return 4;
    default:
      return 3.2;
  }
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function linkKey(link: GraphLink): string {
  const [source, target] = linkEnds(link);
  return `${source}\u001f${target}\u001f${link.relation ?? ""}`;
}

export const GraphCanvas = forwardRef(function GraphCanvas(
  props: Props,
  ref: ForwardedRef<GraphController>,
) {
  const {
    view,
    pathIds,
    hoverId,
    onHover,
    focusId,
    fitOnFocusChange,
    width,
    height,
    onNodeClick,
    onBackgroundClick,
    compact,
    coUsed,
  } = props;
  const fgRef = useRef<FGRef | null>(null);

  const nodeSetKey = useMemo(
    () => view.nodes.map((node) => node.id).sort().join("\u001e"),
    [view.nodes],
  );

  const dataRef = useRef<{
    key: string;
    data: { nodes: GraphNode[]; links: GraphLink[] };
  } | null>(null);
  const dataKey = [
    nodeSetKey,
    view.links.map(linkKey).sort().join("\u001e"),
  ].join("\u001d");
  const previousNodes = new Map(
    (dataRef.current?.data.nodes ?? []).map((node) => [node.id, node]),
  );
  for (const node of view.nodes) {
    const previous = previousNodes.get(node.id);
    if (!previous || previous === node || (node.x != null && node.y != null)) {
      continue;
    }
    if (previous.x != null) node.x = previous.x;
    if (previous.y != null) node.y = previous.y;
    if (previous.vx != null) node.vx = previous.vx;
    if (previous.vy != null) node.vy = previous.vy;
    if (previous.fx != null) node.fx = previous.fx;
    if (previous.fy != null) node.fy = previous.fy;
  }
  if (dataRef.current?.key !== dataKey) {
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    const seedRadii = ringRadii(view.nodes);
    const integrations = view.nodes.filter(
      (node) => node.layer === "integration",
    );
    integrations.forEach((node, index) => {
      if (node.x != null && node.y != null) return;
      const angle = (2 * Math.PI * index) / integrations.length;
      node.x = Math.cos(angle) * seedRadii.integration;
      node.y = Math.sin(angle) * seedRadii.integration;
    });
    for (const node of view.nodes) {
      if (node.layer === "user") {
        node.fx = 0;
        node.fy = 0;
      }
      if (node.layer !== "memory" || (node.x != null && node.y != null)) {
        continue;
      }
      const memoryLink = view.links.find(
        (link) => link.relation === "from" && linkEnds(link)[0] === node.id,
      );
      const targetId = memoryLink
        ? linkEnds(memoryLink)[1]
        : node.integration
          ? `int-${node.integration}`
          : null;
      if (!targetId) continue;
      const integration = byId.get(targetId);
      const hash = hashId(node.id);
      const angle = hashId(targetId) / 0x1_0000_0000 * 2 * Math.PI;
      const integrationX =
        integration?.x ?? Math.cos(angle) * seedRadii.integration;
      const integrationY =
        integration?.y ?? Math.sin(angle) * seedRadii.integration;
      node.x = integrationX + ((hash % 101) / 100 - 0.5) * 12;
      node.y =
        integrationY + (((Math.floor(hash / 101) % 101) / 100) - 0.5) * 12;
    }
    dataRef.current = {
      key: dataKey,
      data: { nodes: view.nodes, links: view.links },
    };
  }
  const data = dataRef.current.data;
  const radii = useMemo(() => ringRadii(data.nodes), [data]);
  const appliedForces = useRef<{
    data: typeof data;
    radii: typeof radii;
  } | null>(null);

  const visibleMemoryCounts = useMemo(() => {
    const visible = new Map<string, number>();
    for (const link of view.links) {
      if (link.relation !== "from") continue;
      const [, target] = linkEnds(link);
      visible.set(target, (visible.get(target) ?? 0) + 1);
    }
    const hidden = new Map<string, number>();
    for (const [integrationId, count] of view.memoryCounts) {
      const remaining = count - (visible.get(integrationId) ?? 0);
      if (remaining > 0) hidden.set(integrationId, remaining);
    }
    return hidden;
  }, [view.links, view.memoryCounts]);

  const fit = useCallback(
    (ids?: Set<string>, durationMs = 440) => {
      const fg = fgRef.current;
      if (!fg) return;
      const padding = Math.min(
        64,
        Math.max(32, Math.round(Math.min(width, height) * 0.06)),
      );
      fg.zoomToFit(
        durationMs,
        padding,
        ids ? (node) => ids.has(node.id) : undefined,
      );
    },
    [width, height],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit: (ids, durationMs) => fit(ids, durationMs ?? 360),
      zoomTo: (scale, durationMs = 360) =>
        fgRef.current?.zoom(scale, durationMs),
      zoomBy: (factor, durationMs = 240) => {
        const current = fgRef.current?.zoom();
        if (typeof current === "number" && Number.isFinite(factor)) {
          fgRef.current?.zoom(current * factor, durationMs);
        }
      },
    }),
    [fit],
  );

  const configureForces = useCallback(() => {
    const fg = fgRef.current;
    if (
      !fg ||
      (appliedForces.current?.data === data &&
        appliedForces.current.radii === radii)
    ) {
      return;
    }
    const charge = fg.d3Force("charge") as
      | { strength: (strength: number) => unknown }
      | undefined;
    charge?.strength(-70);
    const link = fg.d3Force("link") as
      | {
          distance: (distance: (link: GraphLink) => number) => unknown;
          strength: (strength: (link: GraphLink) => number) => unknown;
        }
      | undefined;
    link?.distance((edge) => (edge.relation === "from" ? 26 : 60));
    link?.strength((edge) => (edge.relation === "from" ? 0.7 : 0.08));
    const radial = forceRadial<GraphNode>((node) => radii[node.layer]).strength(
      (node) => (node.layer === "memory" ? 0.08 : 0.7),
    );
    fg.d3Force("radial", radial);
    fg.d3Force(
      "collide",
      forceCollide<GraphNode>((node) => radiusFor(node.layer) + 8),
    );
    appliedForces.current = { data, radii };
    fg.d3ReheatSimulation();
  }, [data, radii]);

  useEffect(() => {
    configureForces();
  }, [configureForces]);

  const focusKey = view.focusSet
    ? [...view.focusSet].sort().join("\u001e")
    : null;
  const focusSetRef = useRef(view.focusSet);
  useLayoutEffect(() => {
    focusSetRef.current = view.focusSet;
  }, [view.focusSet]);
  useEffect(() => {
    if (!fitOnFocusChange) return;
    fit(focusSetRef.current ?? undefined, 440);
  }, [fitOnFocusChange, focusKey, fit]);
  const onEngineStop = useCallback(() => {
    configureForces();
    if (fitOnFocusChange) fit(focusSetRef.current ?? undefined, 440);
  }, [configureForces, fit, fitOnFocusChange]);

  const nodeById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node])),
    [data],
  );

  const drawNode = useCallback(
    (rawNode: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = rawNode as GraphNode;
      if (node.x == null || node.y == null) return;
      const radius = radiusFor(node.layer);
      const focused = focusId === node.id;
      const hovered = hoverId === node.id;
      const alpha = nodeOpacity(node.id, view, pathIds);
      const fill = focused ? "#2E3A8C" : LAYER_INK[node.layer];

      ctx.save();
      ctx.globalAlpha = alpha;
      if (focused) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(46,58,140,0.10)";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = focused ? "#2E3A8C" : LAYER_RING[node.layer];
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();

      if (hovered && !focused) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(26,26,26,0.35)";
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      if (
        shouldLabel(node, {
          hoverId,
          focusSet: view.focusSet,
          pathIds,
          zoom: globalScale,
        })
      ) {
        const fontSize = Math.max((compact ? 10 : 11) / globalScale, 5.5);
        ctx.font = `${fontSize}px "Inter", system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = focused
          ? "#1A1A1A"
          : "rgba(91,91,88,0.92)";
        ctx.fillText(node.label, node.x + radius + 4, node.y);
      }

      const hiddenMemoryCount = visibleMemoryCounts.get(node.id);
      if (node.layer === "integration" && hiddenMemoryCount) {
        const badgeX = node.x + radius - 1;
        const badgeY = node.y - radius + 1;
        const badgeRadius =
          (5 + Math.min(String(hiddenMemoryCount).length - 1, 2)) /
          globalScale;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#F8F7F2";
        ctx.fill();
        ctx.strokeStyle = LAYER_RING.integration;
        ctx.lineWidth = 0.7 / globalScale;
        ctx.stroke();
        ctx.font = `${9 / globalScale}px ui-monospace, SFMono-Regular, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#5B5B58";
        ctx.fillText(String(hiddenMemoryCount), badgeX, badgeY + 0.2 / globalScale);
      }
      ctx.restore();
    },
    [
      compact,
      focusId,
      hoverId,
      pathIds,
      view,
      visibleMemoryCounts,
    ],
  );

  const drawLink = useCallback(
    (rawLink: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const link = rawLink as GraphLink;
      const source =
        typeof link.source === "string" ? null : link.source;
      const target =
        typeof link.target === "string" ? null : link.target;
      if (
        !source ||
        !target ||
        source.x == null ||
        source.y == null ||
        target.x == null ||
        target.y == null
      ) {
        return;
      }
      const style = edgeStyle(link.relation);
      const isFocused = !!focusId &&
        (source.id === focusId || target.id === focusId);
      const alpha = isFocused ? 0.8 : focusId ? style.alpha * 0.1 : style.alpha;
      const stroke = isFocused ? "#2E3A8C" : "#5B5B58";
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) return;
      const unitX = dx / distance;
      const unitY = dy / distance;
      const targetRadius = style.arrow ? radiusFor(target.layer) : 0;
      const endX = target.x - unitX * targetRadius;
      const endY = target.y - unitY * targetRadius;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = style.width / globalScale;
      ctx.setLineDash(style.dash?.map((dash) => dash / globalScale) ?? []);
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      if (style.arrow) {
        const arrowLength = 5 / globalScale;
        const arrowHalfWidth = 2.5 / globalScale;
        const baseX = endX - unitX * arrowLength;
        const baseY = endY - unitY * arrowLength;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          baseX - unitY * arrowHalfWidth,
          baseY + unitX * arrowHalfWidth,
        );
        ctx.lineTo(
          baseX + unitY * arrowHalfWidth,
          baseY - unitX * arrowHalfWidth,
        );
        ctx.closePath();
        ctx.fillStyle = stroke;
        ctx.fill();
      }
      ctx.restore();
    },
    [focusId],
  );

  const drawCoUsed = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (coUsed.length === 0) return;
      const maxWeight = Math.max(...coUsed.map((edge) => edge.weight));
      ctx.save();
      ctx.strokeStyle = LAYER_INK.integration;
      ctx.globalAlpha = 0.25;
      for (const edge of coUsed) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (
          source?.x == null ||
          source.y == null ||
          target?.x == null ||
          target.y == null
        ) {
          continue;
        }
        ctx.beginPath();
        ctx.lineWidth = coUsedWidth(edge.weight, maxWeight) / globalScale;
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
      ctx.restore();
    },
    [coUsed, nodeById],
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
      onEngineStop={onEngineStop}
      onRenderFramePre={drawCoUsed}
      nodeCanvasObject={drawNode}
      nodePointerAreaPaint={(rawNode, color, ctx) => {
        const node = rawNode as GraphNode;
        if (node.x == null || node.y == null) return;
        const radius = radiusFor(node.layer) + 6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }}
      linkCanvasObject={drawLink}
      linkCanvasObjectMode={() => "replace"}
      onNodeClick={(rawNode) => onNodeClick(rawNode as GraphNode)}
      onNodeHover={(rawNode) => {
        const node = rawNode as GraphNode | null;
        onHover(node);
      }}
      onBackgroundClick={onBackgroundClick}
    />
  );
});
