"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { seed } from "@/lib/seed/ontology";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphControls } from "@/components/graph/GraphControls";
import { GraphActionBar } from "@/components/graph/GraphActionBar";
import { GraphLegend } from "@/components/graph/GraphLegend";
import {
  NodeInspector,
  summariseNeighbors,
} from "@/components/graph/NodeInspector";
import {
  type GraphController,
  type GraphFilter,
  type GraphLink,
  type GraphNode,
} from "@/components/graph/types";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import type { NodeLayer } from "@/lib/seed/types";

const DEFAULT_FILTER: GraphFilter = {
  layer: null,
  integration: null,
  query: "",
};

export function GraphRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.graph);
  const lastVerb = useAgentStore((s) => s.lastVerb);
  const pushCard = useAgentStore((s) => s.pushCard);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [filter, setFilter] = useState<GraphFilter>(DEFAULT_FILTER);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [highlightNeighborIds, setHighlightNeighborIds] = useState<Set<string>>(
    new Set(),
  );
  const [pathIds, setPathIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* container size — drives canvas + responsive layout */
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = size.w < 560 || size.h < 400;
  const showInspector = !compact;
  const inspectorWidth = Math.min(280, Math.max(220, Math.round(size.w * 0.32)));

  /* Inner safe region: canvas lives here so floating overlays never sit on top of nodes. */
  const inset = compact
    ? { top: 44, right: 12, bottom: 32, left: 12 }
    : { top: 52, right: 12, bottom: 40, left: 12 };

  /* derived data: filter nodes / edges */
  const allNodes = seed.nodes as GraphNode[];
  const allEdges = seed.edges as GraphLink[];

  const filtered = useMemo(() => {
    let nodes = allNodes;
    if (filter.layer) nodes = nodes.filter((n) => n.layer === filter.layer);
    if (filter.integration)
      nodes = nodes.filter((n) => n.integration === filter.integration);
    if (filter.query.trim()) {
      const q = filter.query.trim().toLowerCase();
      nodes = nodes.filter((n) => n.label.toLowerCase().includes(q));
    }
    const idSet = new Set(nodes.map((n) => n.id));
    const links = allEdges.filter((e) => {
      const s = typeof e.source === "string" ? e.source : e.source.id;
      const t = typeof e.target === "string" ? e.target : e.target.id;
      return idSet.has(s) && idSet.has(t);
    });
    return { nodes, links };
  }, [allNodes, allEdges, filter]);

  /* adjacency for neighbors / path */
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const link of allEdges) {
      const s = typeof link.source === "string" ? link.source : link.source.id;
      const t = typeof link.target === "string" ? link.target : link.target.id;
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [allEdges]);

  /* find shortest path BFS */
  const findPath = useCallback(
    (from: string, to: string): string[] => {
      if (from === to) return [from];
      const visited = new Set<string>([from]);
      const parent = new Map<string, string>();
      const queue: string[] = [from];
      while (queue.length) {
        const cur = queue.shift()!;
        const adj = adjacency.get(cur);
        if (!adj) continue;
        for (const nb of adj) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          parent.set(nb, cur);
          if (nb === to) {
            const path: string[] = [nb];
            let p = cur;
            while (p !== from) {
              path.push(p);
              p = parent.get(p)!;
            }
            path.push(from);
            return path.reverse();
          }
          queue.push(nb);
        }
      }
      return [];
    },
    [adjacency],
  );

  /* react to agent verbs */
  useEffect(() => {
    if (!lastVerb) return;
    const ctrl = controllerRef.current;
    const v = lastVerb.verb;
    const a = lastVerb.args;

    if (v === "highlight" && typeof a.node_id === "string") {
      const nid = a.node_id;
      setHighlightId(nid);
      setHighlightNeighborIds(adjacency.get(nid) ?? new Set());
      setPathIds(new Set());
      ctrl?.focusNode(nid, 380, 2.4);
    } else if (v === "explain" && typeof a.target === "string") {
      const node = allNodes.find((n) => n.id === a.target);
      if (node) {
        pushCard({
          id: `explain-${node.id}`,
          kind: "memory",
          data: {
            text: `${node.label} — ${node.layer} layer${node.confidence ? `, confidence ${node.confidence.toFixed(2)}` : ""}.`,
            confidence: node.confidence,
          },
          ttl: 6500,
        });
        ctrl?.focusNode(node.id, 380, 2.2);
      }
    } else if (v === "compare" && typeof a.a === "string" && typeof a.b === "string") {
      const path = findPath(a.a, a.b);
      if (path.length > 0) {
        setPathIds(new Set(path));
        setHighlightId(null);
        setHighlightNeighborIds(new Set());
      }
    }
  }, [lastVerb, adjacency, allNodes, pushCard, findPath]);

  /* graph imperative ops shared between window-global helper and the
   * agent-callable room-tools registry. */
  const graphOps = useMemo(
    () => ({
      focusNode: (id: string) =>
        controllerRef.current?.focusNode(id, 360, 2.4),
      zoomFit: () => controllerRef.current?.zoomToFit(380),
      zoomTo: (s: number) => controllerRef.current?.zoomTo(s, 280),
      selectNode: (id: string | null) => setSelectedId(id),
      highlight: (id: string | null) => {
        setHighlightId(id);
        setHighlightNeighborIds(id ? (adjacency.get(id) ?? new Set()) : new Set());
        setPathIds(new Set());
      },
      neighbors: (id: string | null) => {
        if (!id) {
          setHighlightId(null);
          setHighlightNeighborIds(new Set());
          return;
        }
        setHighlightId(id);
        setHighlightNeighborIds(adjacency.get(id) ?? new Set());
      },
      path: (a: string, b: string) => {
        const p = findPath(a, b);
        if (p.length) {
          setPathIds(new Set(p));
          setHighlightId(null);
          setHighlightNeighborIds(new Set());
        }
      },
      clear: () => {
        setHighlightId(null);
        setHighlightNeighborIds(new Set());
        setPathIds(new Set());
        setSelectedId(null);
        setFilter(DEFAULT_FILTER);
      },
      filterLayer: (layer: NodeLayer | null) =>
        setFilter((f) => ({ ...f, layer })),
      filterIntegration: (integration: string | null) =>
        setFilter((f) => ({ ...f, integration })),
      search: (q: string) => setFilter((f) => ({ ...f, query: q })),
    }),
    [adjacency, findPath],
  );

  /* expose graph controls to window for direct testing (Playwright + dev console) */
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __graph?: typeof graphOps }).__graph = graphOps;
  }, [graphOps]);

  /* register agent-callable tools (consumed by ui.tool events from the LLM) */
  useEffect(() => {
    return registerTools("graph", [
      {
        name: "focus_node",
        description:
          "Center the graph on a node and zoom in. Use to draw the user's eye to one entity, integration, memory, skill, or workflow.",
        args: { node_id: "node id, e.g. user-maya, ent-product-bugs, wf-bug-triage" },
        run: (args) => {
          const id = String(args.node_id ?? "");
          if (id) graphOps.focusNode(id);
        },
      },
      {
        name: "zoom_fit",
        description:
          "Reset the graph viewport to fit all currently visible nodes with breathing room.",
        run: () => graphOps.zoomFit(),
      },
      {
        name: "zoom_to",
        description: "Set graph zoom level. Range 0.2 (far) to 4 (close).",
        args: { scale: "number 0.2..4" },
        run: (args) => {
          const n = Number(args.scale);
          if (Number.isFinite(n)) graphOps.zoomTo(n);
        },
      },
      {
        name: "highlight",
        description:
          "Highlight a node and its direct neighbors. Other nodes fade. Pass null to clear.",
        args: { node_id: "node id or null to clear" },
        run: (args) => {
          const id = args.node_id ? String(args.node_id) : null;
          graphOps.highlight(id);
        },
      },
      {
        name: "neighbors",
        description:
          "Highlight a node + 1-hop neighbors. Like highlight, but does not zoom.",
        args: { node_id: "node id" },
        run: (args) => {
          const id = args.node_id ? String(args.node_id) : null;
          graphOps.neighbors(id);
        },
      },
      {
        name: "path",
        description:
          "Highlight the shortest path between two nodes. Use when comparing/relating entities.",
        args: { from: "source node id", to: "target node id" },
        run: (args) => {
          const a = String(args.from ?? "");
          const b = String(args.to ?? "");
          if (a && b) graphOps.path(a, b);
        },
      },
      {
        name: "select",
        description:
          "Open the node inspector for a node (shows neighbors, confidence, and quick actions).",
        args: { node_id: "node id, or null/empty to close" },
        run: (args) => {
          const id = args.node_id ? String(args.node_id) : null;
          graphOps.selectNode(id);
          if (id) graphOps.highlight(id);
        },
      },
      {
        name: "filter_layer",
        description:
          "Filter nodes to a single layer. Pass null/all to clear. Layers: user, integration, entity, memory, skill, workflow.",
        args: { layer: "layer name or null/all" },
        run: (args) => {
          const v = args.layer;
          if (v == null || v === "all") graphOps.filterLayer(null);
          else graphOps.filterLayer(v as NodeLayer);
        },
      },
      {
        name: "filter_integration",
        description:
          "Filter nodes to those connected to one integration (slack, github, linear, gmail, notion, perplexity).",
        args: { integration: "integration slug or null" },
        run: (args) => {
          const v = args.integration;
          graphOps.filterIntegration(typeof v === "string" && v ? v : null);
        },
      },
      {
        name: "search",
        description: "Filter nodes by a label substring. Empty string clears.",
        args: { query: "substring" },
        run: (args) => {
          graphOps.search(String(args.query ?? ""));
        },
      },
      {
        name: "clear",
        description:
          "Reset filters, highlights, paths, and node selection. Returns the graph to its calm full view.",
        run: () => graphOps.clear(),
      },
    ]);
  }, [graphOps]);

  const selectedNode = useMemo(
    () => allNodes.find((n) => n.id === selectedId) ?? null,
    [allNodes, selectedId],
  );

  const inspectorNeighbors = useMemo(
    () => summariseNeighbors(selectedNode, allNodes, allEdges),
    [selectedNode, allNodes, allEdges],
  );

  const hasFocus =
    !!highlightId ||
    pathIds.size > 0 ||
    !!filter.layer ||
    !!filter.integration ||
    !!filter.query;

  /* canvas dimensions: subtract inspector width on wide layouts, then inset for overlays */
  const outerW = showInspector && selectedNode ? size.w - inspectorWidth : size.w;
  const canvasW = Math.max(0, outerW - inset.left - inset.right);
  const canvasH = Math.max(0, size.h - inset.top - inset.bottom);

  return (
    <RoomStateOverlay room="graph" state={roomState}>
      <div
        ref={wrapRef}
        data-testid="graph-canvas"
        className="absolute inset-0 overflow-hidden bg-paper-1"
      >
        {/* Top caption strip */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-3 px-3 py-2">
          {/* (left + right overlays render below; this strip stays empty for breathing room) */}
        </div>

        {/* Canvas — inset so floating overlays don't sit on top of nodes */}
        <div
          className="absolute"
          style={{
            left: inset.left,
            top: inset.top,
            width: canvasW,
            height: canvasH,
          }}
        >
          {canvasW > 0 && canvasH > 0 && (
            <GraphCanvas
              ref={controllerRef}
              nodes={filtered.nodes}
              links={filtered.links}
              filter={filter}
              width={canvasW}
              height={canvasH}
              selectedId={selectedId}
              highlightId={highlightId}
              highlightNeighborIds={highlightNeighborIds}
              pathIds={pathIds}
              onNodeClick={(n) => {
                setSelectedId((cur) => (cur === n.id ? null : n.id));
                setHighlightId(n.id);
                setHighlightNeighborIds(adjacency.get(n.id) ?? new Set());
                setPathIds(new Set());
              }}
              onNodeHover={() => {}}
              onBackgroundClick={() => {
                setSelectedId(null);
                setHighlightId(null);
                setHighlightNeighborIds(new Set());
                setPathIds(new Set());
              }}
            />
          )}
        </div>

        {/* Top-left controls */}
        <GraphControls
          filter={filter}
          onFilterLayer={(layer) => setFilter((f) => ({ ...f, layer }))}
          onSearch={(q) => setFilter((f) => ({ ...f, query: q }))}
          compact={compact}
          visibleNodes={filtered.nodes.length}
          totalNodes={allNodes.length}
        />

        {/* Top-right action bar */}
        <GraphActionBar
          onZoomFit={() => controllerRef.current?.zoomToFit(380, 56)}
          onZoomIn={() => {
            const v = controllerRef.current?.getViewport();
            const cur = v?.scale ?? 1;
            controllerRef.current?.zoomTo(cur * 1.4, 240);
          }}
          onZoomOut={() => {
            const v = controllerRef.current?.getViewport();
            const cur = v?.scale ?? 1;
            controllerRef.current?.zoomTo(cur / 1.4, 240);
          }}
          onClear={() => {
            setHighlightId(null);
            setHighlightNeighborIds(new Set());
            setPathIds(new Set());
            setFilter(DEFAULT_FILTER);
          }}
          hasFocus={hasFocus}
        />

        {/* Bottom-left legend */}
        <GraphLegend
          compact={compact}
          active={filter.layer}
          onPick={(layer) => setFilter((f) => ({ ...f, layer }))}
        />

        {/* Right-side inspector panel */}
        {showInspector && (
          <NodeInspector
            node={selectedNode}
            neighbors={inspectorNeighbors}
            width={size.w}
            panelWidth={inspectorWidth}
            onClose={() => {
              setSelectedId(null);
              setHighlightId(null);
              setHighlightNeighborIds(new Set());
            }}
            onFocus={() => {
              if (selectedNode) {
                controllerRef.current?.focusNode(selectedNode.id, 360, 2.6);
              }
            }}
            onExpandNeighbors={() => {
              if (selectedNode) {
                setHighlightId(selectedNode.id);
                setHighlightNeighborIds(adjacency.get(selectedNode.id) ?? new Set());
                setPathIds(new Set());
              }
            }}
            onExplain={() => {
              if (selectedNode) {
                pushCard({
                  id: `explain-${selectedNode.id}`,
                  kind: "memory",
                  data: {
                    text: `${selectedNode.label} — ${selectedNode.layer} layer${selectedNode.confidence ? `, confidence ${selectedNode.confidence.toFixed(2)}` : ""}.`,
                    confidence: selectedNode.confidence,
                  },
                  ttl: 6500,
                });
              }
            }}
            onPickNeighbor={(id) => {
              setSelectedId(id);
              setHighlightId(id);
              setHighlightNeighborIds(adjacency.get(id) ?? new Set());
              controllerRef.current?.focusNode(id, 380, 2.4);
            }}
          />
        )}

        {/* Compact-mode floating inspector card (small windows) */}
        {!showInspector && selectedNode && (
          <div
            className="pointer-events-auto absolute bottom-3 right-3 z-20 max-w-[220px] rounded-md border border-rule bg-paper-0/95 px-3 py-2 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
                {selectedNode.layer}
              </span>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="close"
                className="text-ink-35 hover:text-ink-90"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeLinecap="round" />
                  <line x1="2" y1="8" x2="8" y2="2" stroke="currentColor" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-ink-90">
              {selectedNode.label}
            </p>
            <button
              type="button"
              onClick={() =>
                controllerRef.current?.focusNode(selectedNode.id, 360, 2.6)
              }
              className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-accent-indigo"
            >
              focus →
            </button>
          </div>
        )}
      </div>
    </RoomStateOverlay>
  );
}
