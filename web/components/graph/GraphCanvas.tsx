"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

// react-force-graph-2d pulls canvas APIs that need the browser; load dynamic.
const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  { ssr: false },
);

interface Node {
  id: string;
  label: string;
  layer:
    | "user"
    | "integration"
    | "entity"
    | "memory"
    | "skill"
    | "workflow";
}

interface Edge {
  source: string;
  target: string;
}

const SEED_NODES: Node[] = [
  { id: "u", label: "you", layer: "user" },
  { id: "slack", label: "slack", layer: "integration" },
  { id: "linear", label: "linear", layer: "integration" },
  { id: "gmail", label: "gmail", layer: "integration" },
  { id: "notion", label: "notion", layer: "integration" },
  { id: "github", label: "github", layer: "integration" },
  { id: "alice", label: "Alice", layer: "entity" },
  { id: "bob", label: "Bob", layer: "entity" },
  { id: "bugs", label: "#product-bugs", layer: "entity" },
  { id: "ship", label: "ship-it", layer: "entity" },
  { id: "m1", label: "bug triage pattern", layer: "memory" },
  { id: "m2", label: "friday update cadence", layer: "memory" },
  { id: "m3", label: "PR review SLA", layer: "memory" },
  { id: "s1", label: "triage", layer: "skill" },
  { id: "s2", label: "summarise", layer: "skill" },
  { id: "s3", label: "remind", layer: "skill" },
  { id: "w1", label: "bug triage pipeline", layer: "workflow" },
  { id: "w2", label: "weekly update", layer: "workflow" },
];

const SEED_EDGES: Edge[] = [
  { source: "u", target: "slack" },
  { source: "u", target: "linear" },
  { source: "u", target: "gmail" },
  { source: "u", target: "notion" },
  { source: "u", target: "github" },
  { source: "slack", target: "alice" },
  { source: "slack", target: "bob" },
  { source: "slack", target: "bugs" },
  { source: "github", target: "ship" },
  { source: "bugs", target: "m1" },
  { source: "notion", target: "m2" },
  { source: "github", target: "m3" },
  { source: "m1", target: "s1" },
  { source: "m2", target: "s2" },
  { source: "m3", target: "s3" },
  { source: "s1", target: "w1" },
  { source: "s2", target: "w2" },
  { source: "s3", target: "w1" },
];

const LAYER_INK: Record<Node["layer"], string> = {
  user: "#1A1A1A",
  integration: "#5B5B58",
  entity: "#2E3A8C",
  memory: "#9C9A93",
  skill: "#3E7D53",
  workflow: "#B8873A",
};

export function GraphCanvas() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => ({ nodes: SEED_NODES, links: SEED_EDGES }),
    [],
  );

  return (
    <div ref={wrapRef} className="h-full w-full">
      <ForceGraph2D
        graphData={data}
        width={size.w}
        height={size.h}
        backgroundColor="#F4F2EC"
        nodeRelSize={4}
        linkColor={() => "#D9D6CD"}
        linkWidth={1}
        cooldownTicks={120}
        nodeCanvasObject={(nodeRaw, ctx, globalScale) => {
          const node = nodeRaw as Node & { x?: number; y?: number };
          if (node.x == null || node.y == null) return;
          const color = LAYER_INK[node.layer];
          const radius =
            node.layer === "user" ? 6 : node.layer === "workflow" ? 5 : 4;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();

          const label = node.label;
          const fontSize = Math.max(10 / globalScale, 6);
          ctx.font = `${fontSize}px Inter, sans-serif`;
          ctx.fillStyle = "#5B5B58";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(label, node.x + radius + 4, node.y);
        }}
      />
    </div>
  );
}
