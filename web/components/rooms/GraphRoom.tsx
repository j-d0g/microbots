"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { seed } from "@/lib/seed/ontology";
import { Hairline } from "@/components/primitives/Hairline";
import { Chip } from "@/components/primitives/Chip";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import type { NodeLayer } from "@/lib/seed/types";

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  { ssr: false },
);

const LAYER_INK: Record<NodeLayer, string> = {
  user: "#1A1A1A",
  integration: "#5B5B58",
  entity: "#2E3A8C",
  memory: "#9C9A93",
  skill: "#3E7D53",
  workflow: "#B8873A",
};

const LAYER_LABELS: NodeLayer[] = [
  "user", "integration", "entity", "memory", "skill", "workflow",
];

export function GraphRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.graph);
  const lastVerb = useAgentStore((s) => s.lastVerb);
  const pushCard = useAgentStore((s) => s.pushCard);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [filterLayer, setFilterLayer] = useState<NodeLayer | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (lastVerb?.verb === "highlight" && typeof lastVerb.args.node_id === "string") {
      setHighlightId(lastVerb.args.node_id);
    }
    if (lastVerb?.verb === "explain" && typeof lastVerb.args.target === "string") {
      const node = seed.nodes.find((n) => n.id === lastVerb.args.target);
      if (node) {
        pushCard({
          id: `explain-${node.id}`,
          kind: "memory",
          data: { text: `${node.label}: ${node.layer} layer node.${node.confidence ? ` Confidence ${node.confidence.toFixed(2)}.` : ""}`, confidence: node.confidence },
          ttl: 6000,
        });
      }
    }
  }, [lastVerb, pushCard]);

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

  const filteredNodes = useMemo(() => {
    if (!filterLayer) return seed.nodes;
    return seed.nodes.filter((n) => n.layer === filterLayer);
  }, [filterLayer]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const data = useMemo(() => ({
    nodes: filteredNodes,
    links: seed.edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    ),
  }), [filteredNodes, filteredNodeIds]);

  const nodeCanvasObject = useCallback(
    (nodeRaw: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = nodeRaw as { id: string; label: string; layer: NodeLayer; x?: number; y?: number };
      if (node.x == null || node.y == null) return;

      const isHighlighted = highlightId === node.id;
      const alpha = highlightId && !isHighlighted ? 0.2 : 1;

      const color = LAYER_INK[node.layer];
      const radius = node.layer === "user" ? 6 : node.layer === "workflow" ? 5 : 3.5;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isHighlighted ? "#2E3A8C" : color;
      ctx.fill();

      const degree = seed.edges.filter(
        (e) => e.source === node.id || e.target === node.id,
      ).length;
      if (degree >= 3 || isHighlighted) {
        const fontSize = Math.max(10 / globalScale, 6);
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.fillStyle = "#5B5B58";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(node.label, node.x + radius + 4, node.y);
      }
      ctx.globalAlpha = 1;
    },
    [highlightId],
  );

  return (
    <RoomStateOverlay room="graph" state={roomState}>
      <section>
        <header className="mb-8">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            memory · live ontology · {seed.nodes.length} nodes
          </p>
          <h1 className="mt-2 text-[40px] font-medium leading-[1.1] tracking-tight">
            What I remember about your work.
          </h1>
          <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-60">
            Every integration, entity, memory, skill, and workflow -- from newest
            to oldest. Nodes settle in as I learn.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          <Chip
            tone={filterLayer === null ? "accent" : "neutral"}
            className="cursor-pointer"
          >
            <button type="button" onClick={() => setFilterLayer(null)}>all</button>
          </Chip>
          {LAYER_LABELS.map((l) => (
            <Chip
              key={l}
              tone={filterLayer === l ? "accent" : "neutral"}
              className="cursor-pointer"
            >
              <button type="button" onClick={() => setFilterLayer(l)}>{l}</button>
            </Chip>
          ))}
          {highlightId && (
            <button
              type="button"
              onClick={() => setHighlightId(null)}
              className="font-mono text-[11px] text-ink-35 hover:text-ink-60"
            >
              clear highlight
            </button>
          )}
        </div>

        <Hairline className="mb-4" />

        <div
          ref={wrapRef}
          data-testid="graph-canvas"
          className="h-[640px] w-full rounded-lg border border-rule bg-paper-1"
        >
          <ForceGraph2D
            graphData={data}
            width={size.w}
            height={size.h}
            backgroundColor="#F4F2EC"
            nodeRelSize={4}
            linkColor={() => "#D9D6CD"}
            linkWidth={1}
            cooldownTicks={120}
            nodeCanvasObject={nodeCanvasObject}
            onNodeClick={(nodeRaw) => {
              const node = nodeRaw as { id: string };
              setHighlightId(node.id === highlightId ? null : node.id);
            }}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {LAYER_LABELS.map((l) => (
            <div key={l} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: LAYER_INK[l] }}
              />
              <span className="font-mono text-[10px] text-ink-35">{l}</span>
            </div>
          ))}
        </div>
      </section>
    </RoomStateOverlay>
  );
}
