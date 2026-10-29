"use client";

import { useEffect, useRef, useState } from "react";
import { GraphActionBar } from "@/components/graph/GraphActionBar";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphControls } from "@/components/graph/GraphControls";
import { GraphLegend } from "@/components/graph/GraphLegend";
import { GraphRoomInspector } from "@/components/graph/GraphRoomInspector";
import { GraphStates } from "@/components/graph/GraphStates";
import { useKgGraph } from "@/components/graph/use-kg-graph";
import { useGraphRoomState } from "@/components/graph/use-graph-room-state";
import type { GraphController } from "@/components/graph/types";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";

export function GraphRoom({
  payload,
  frozen = false,
}: {
  payload?: Record<string, unknown>;
  frozen?: boolean;
}) {
  const roomState = useAgentStore((state) => state.roomStates.graph);
  const pushCard = useAgentStore((state) => state.pushCard);
  const userId = useAgentStore((state) => state.userId);
  const composioConfigured = useAgentStore(
    (state) => state.backendHealth?.composioConfigured ?? false,
  );
  const { graph, loading, loadError, refresh } = useKgGraph(
    userId,
    composioConfigured,
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const payloadCompact = payload?.compact === true;
  const payloadFocus =
    typeof payload?.focus === "string" ? payload.focus : undefined;
  const {
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
    clearView,
  } = useGraphRoomState(graph, payloadFocus, controllerRef);

  useEffect(() => {
    if (!wrapRef.current) return;
    const element = wrapRef.current;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const narrow = size.w < 560 || size.h < 400;
  const showInspector = !narrow && !payloadCompact;
  const inspectorWidth = Math.min(280, Math.max(220, Math.round(size.w * 0.32)));
  const inset = payloadCompact
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : narrow
      ? { top: 44, right: 12, bottom: 32, left: 12 }
      : { top: 52, right: 12, bottom: 40, left: 12 };
  const outerWidth = showInspector && focusedNode
    ? size.w - inspectorWidth
    : size.w;
  const canvasWidth = Math.max(0, outerWidth - inset.left - inset.right);
  const canvasHeight = Math.max(0, size.h - inset.top - inset.bottom);
  const refreshVisible = userId && graph.nodes.length > 0;

  return (
    <RoomStateOverlay room="graph" state={roomState}>
      <div
        ref={wrapRef}
        data-testid="graph-canvas"
        className="absolute inset-0 overflow-hidden bg-paper-1"
      >
        <GraphStates
          userId={userId}
          loading={loading}
          loadError={loadError}
          nodeCount={graph.nodes.length}
          onOpenSettings={() => window.location.assign("/settings")}
          onRefresh={refresh}
        />

        <div
          className="absolute"
          style={{
            left: inset.left,
            top: inset.top,
            width: canvasWidth,
            height: canvasHeight,
          }}
        >
          {canvasWidth > 0 && canvasHeight > 0 && (
            <GraphCanvas
              ref={controllerRef}
              view={view}
              pathIds={pathIds}
              hoverId={hoverId}
              onHover={(node) => setHoverId(node?.id ?? null)}
              focusId={focusId}
              fitOnFocusChange={fitOnFocusChange}
              width={canvasWidth}
              height={canvasHeight}
              compact={narrow}
              coUsed={coUsed}
              frozen={frozen}
              onNodeClick={(node) => {
                setFocusId((current) => (current === node.id ? null : node.id));
                setPathIds(new Set());
                setFitOnFocusChange(true);
              }}
              onBackgroundClick={() => {
                setFocusId(null);
                setPathIds(new Set());
                setFitOnFocusChange(true);
              }}
            />
          )}
        </div>

        {!payloadCompact && (
          <GraphControls
            filter={filter}
            onFilterLayer={(layer) =>
              setFilter((current) => ({ ...current, layer }))
            }
            onSearch={(query) =>
              setFilter((current) => ({ ...current, query }))
            }
            compact={narrow}
            visibleNodes={view.nodes.length}
            totalNodes={graph.nodes.length}
          />
        )}

        {!payloadCompact && (
          <GraphActionBar
            onZoomFit={() => controllerRef.current?.fit(
              view.focusSet ?? undefined,
              380,
            )}
            onZoomIn={() => controllerRef.current?.zoomBy(1.4, 240)}
            onZoomOut={() => controllerRef.current?.zoomBy(1 / 1.4, 240)}
            onClear={clearView}
            hasFocus={hasFocus}
            onRefresh={refreshVisible ? refresh : undefined}
            refreshing={loading}
          />
        )}

        {!payloadCompact && (
          <GraphLegend
            compact={narrow}
            active={filter.layer}
            onPick={(layer) =>
              setFilter((current) => ({ ...current, layer }))
            }
          />
        )}

        <GraphRoomInspector
          node={focusedNode}
          nodes={graph.nodes}
          links={graph.links}
          width={size.w}
          panelWidth={inspectorWidth}
          narrow={narrow}
          compact={payloadCompact}
          onClose={() => {
            setFocusId(null);
            setPathIds(new Set());
            setFitOnFocusChange(true);
          }}
          onFocus={() =>
            controllerRef.current?.fit(view.focusSet ?? undefined, 360)
          }
          onExplain={() => {
            if (!focusedNode) return;
            pushCard({
              id: `explain-${focusedNode.id}`,
              kind: "memory",
              data: {
                text: `${focusedNode.label} — ${focusedNode.layer} layer${focusedNode.confidence ? `, confidence ${focusedNode.confidence.toFixed(2)}` : ""}.`,
                confidence: focusedNode.confidence,
              },
              ttl: 6500,
            });
          }}
          onPickNeighbor={(id) => {
            setFocusId(id);
            setPathIds(new Set());
            setFitOnFocusChange(true);
          }}
        />
      </div>
    </RoomStateOverlay>
  );
}
