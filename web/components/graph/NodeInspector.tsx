"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/cn";
import { LAYER_INK } from "./types";
import type { GraphNode, GraphLink } from "./types";

interface NeighborSummary {
  id: string;
  label: string;
  layer: GraphNode["layer"];
  relation?: string;
}

interface Props {
  node: GraphNode | null;
  neighbors: NeighborSummary[];
  onClose: () => void;
  onFocus: () => void;
  onExpandNeighbors: () => void;
  onExplain: () => void;
  onPickNeighbor: (id: string) => void;
  /* layout */
  width: number;
  panelWidth: number;
}

export function NodeInspector({
  node,
  neighbors,
  onClose,
  onFocus,
  onExpandNeighbors,
  onExplain,
  onPickNeighbor,
  panelWidth,
}: Props) {
  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          key={node.id}
          initial={{ x: panelWidth, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: panelWidth, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className={cn(
            "pointer-events-auto absolute right-0 top-0 z-20",
            "h-full overflow-y-auto",
            "border-l border-rule bg-paper-0/96 backdrop-blur-md",
            "muji-scroll",
          )}
          style={{ width: panelWidth }}
        >
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-rule bg-paper-0/95 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: LAYER_INK[node.layer] }}
                />
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
                  {node.layer}
                  {node.integration && ` · ${node.integration}`}
                </span>
              </div>
              <h2 className="mt-1.5 truncate text-[15px] leading-snug text-ink-90">
                {node.label}
              </h2>
              {node.confidence != null && (
                <p className="mt-1 font-mono text-[10px] tracking-wider text-ink-35">
                  confidence {node.confidence.toFixed(2)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="close inspector"
              className="-mr-1 flex h-6 w-6 items-center justify-center rounded text-ink-35 hover:bg-paper-2 hover:text-ink-90"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeLinecap="round" />
                <line x1="2" y1="8" x2="8" y2="2" stroke="currentColor" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="space-y-4 px-4 py-4">
            {/* Quick actions */}
            <section className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
                actions
              </p>
              <div className="flex flex-col gap-1">
                <ActionRow label="focus + zoom" onClick={onFocus} />
                <ActionRow label="expand 1-hop" onClick={onExpandNeighbors} />
                <ActionRow label="explain" onClick={onExplain} />
                <ActionRow label="close" onClick={onClose} />
              </div>
            </section>

            {/* Neighbors */}
            <section className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
                neighbors · {neighbors.length}
              </p>
              {neighbors.length === 0 ? (
                <p className="text-[12px] text-ink-35">no connections.</p>
              ) : (
                <ul className="-mx-1">
                  {neighbors.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onPickNeighbor(n.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-1 py-1 text-left",
                          "hover:bg-paper-2 transition-colors",
                        )}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: LAYER_INK[n.layer] }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-90">
                          {n.label}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
                          {n.layer}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function ActionRow({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between rounded border border-rule bg-paper-0 px-2.5 py-1.5",
        "text-left font-mono text-[10px] uppercase tracking-wider text-ink-60",
        "hover:bg-paper-1 hover:text-ink-90 transition-colors",
      )}
    >
      <span className="truncate">{label}</span>
      <span aria-hidden className="ml-2 text-ink-35">→</span>
    </button>
  );
}

export function summariseNeighbors(
  node: GraphNode | null,
  nodes: GraphNode[],
  links: GraphLink[],
  limit = 24,
): NeighborSummary[] {
  if (!node) return [];
  const id = node.id;
  const out: NeighborSummary[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const link of links) {
    const sId = typeof link.source === "string" ? link.source : link.source.id;
    const tId = typeof link.target === "string" ? link.target : link.target.id;
    let neighborId: string | null = null;
    if (sId === id) neighborId = tId;
    else if (tId === id) neighborId = sId;
    if (!neighborId || seen.has(neighborId)) continue;
    const n = byId.get(neighborId);
    if (!n) continue;
    seen.add(neighborId);
    out.push({
      id: neighborId,
      label: n.label,
      layer: n.layer,
      relation: link.relation,
    });
    if (out.length >= limit) break;
  }
  return out;
}
