"use client";

import { useMemo } from "react";
import { NodeInspector, summariseNeighbors } from "./NodeInspector";
import type { GraphLink, GraphNode } from "./types";

interface Props {
  node: GraphNode | null;
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  panelWidth: number;
  narrow: boolean;
  compact: boolean;
  onClose: () => void;
  onFocus: () => void;
  onExplain: () => void;
  onPickNeighbor: (id: string) => void;
}

export function GraphRoomInspector({
  node,
  nodes,
  links,
  width,
  panelWidth,
  narrow,
  compact,
  onClose,
  onFocus,
  onExplain,
  onPickNeighbor,
}: Props) {
  const neighbors = useMemo(
    () => summariseNeighbors(node, nodes, links),
    [node, nodes, links],
  );

  return (
    <>
      {!narrow && !compact && (
        <NodeInspector
          node={node}
          neighbors={neighbors}
          width={width}
          panelWidth={panelWidth}
          onClose={onClose}
          onFocus={onFocus}
          onExplain={onExplain}
          onPickNeighbor={onPickNeighbor}
        />
      )}

      {!compact && narrow && node && (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-20 max-w-[220px] rounded-md border border-rule bg-paper-0/95 px-3 py-2 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
              {node.layer}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="close"
              className="text-ink-35 hover:text-ink-90"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
              >
                <line
                  x1="2"
                  y1="2"
                  x2="8"
                  y2="8"
                  stroke="currentColor"
                  strokeLinecap="round"
                />
                <line
                  x1="2"
                  y1="8"
                  x2="8"
                  y2="2"
                  stroke="currentColor"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-90">{node.label}</p>
          <button
            type="button"
            onClick={onFocus}
            className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-accent-indigo"
          >
            focus →
          </button>
        </div>
      )}
    </>
  );
}
