"use client";

import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import { useAgentStore, type WindowState } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  getUser,
  getIntegrations,
  getEntities,
  getMemories,
  getSkills,
  getWorkflows,
} from "@/lib/kg-client";
import type { NodeLayer } from "@/lib/seed/types";

const LAYER_DOT: Record<NodeLayer, string> = {
  user: "bg-ink-90",
  integration: "bg-ink-60",
  entity: "bg-accent-indigo",
  memory: "bg-ink-35",
  skill: "bg-confidence-high",
  workflow: "bg-confidence-med",
};

const LAYER_ORDER: NodeLayer[] = [
  "user",
  "integration",
  "entity",
  "memory",
  "skill",
  "workflow",
];

interface LayerCounts {
  user: number;
  integration: number;
  entity: number;
  memory: number;
  skill: number;
  workflow: number;
}

interface RecentNode {
  id: string;
  label: string;
  layer: NodeLayer;
}

interface SidelineSnapshot {
  counts: LayerCounts;
  totalEdges: number;
  recents: RecentNode[];
}

async function fetchSnapshot(userId: string): Promise<SidelineSnapshot> {
  const [user, integrations, entities, memories, skills, workflows] =
    await Promise.all([
      getUser(userId).catch(() => null),
      getIntegrations(userId).catch(() => []),
      getEntities("person", userId).catch(() => []),
      getMemories({ by: "confidence", limit: 3 }, userId).catch(() => []),
      getSkills({ minStrength: 1 }, userId).catch(() => []),
      getWorkflows(userId).catch(() => []),
    ]);

  const counts: LayerCounts = {
    user: user ? 1 : 0,
    integration: integrations.length,
    entity: user?.entity_count ?? entities.length,
    memory: user?.memory_count ?? memories.length,
    skill: user?.skill_count ?? skills.length,
    workflow: user?.workflow_count ?? workflows.length,
  };

  const edgeEstimate =
    integrations.length +
    skills.reduce((s, sk) => s + sk.integrations.length, 0) +
    workflows.reduce((s, w) => s + w.skill_chain.length, 0);

  const totalNodes = Object.values(counts).reduce((s, n) => s + n, 0);
  const totalEdges = edgeEstimate || Math.round(totalNodes * 1.6);

  const recents: RecentNode[] = [
    ...memories.slice(0, 2).map((m) => ({
      id: m.id,
      label: m.content.length > 40 ? m.content.slice(0, 37) + "…" : m.content,
      layer: "memory" as NodeLayer,
    })),
    ...skills.slice(0, 2).map((s) => ({ id: s.id, label: s.name, layer: "skill" as NodeLayer })),
    ...workflows.slice(0, 2).map((w) => ({ id: w.id, label: w.name, layer: "workflow" as NodeLayer })),
    ...entities.slice(0, 2).map((e) => ({ id: e.id, label: e.name, layer: "entity" as NodeLayer })),
  ];

  return { counts, totalEdges, recents };
}

export function GraphSideline({ win }: { win: WindowState }) {
  const userId = useAgentStore((s) => s.userId);
  const [snapshot, setSnapshot] = useState<SidelineSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) { setSnapshot(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchSnapshot(userId)
      .then((s) => { if (!cancelled) setSnapshot(s); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const filterLayer = typeof win.payload?.filterLayer === "string"
    ? (win.payload.filterLayer as NodeLayer) : null;
  const filterQuery = typeof win.payload?.filterQuery === "string"
    ? win.payload.filterQuery : "";
  const filterIntegration = typeof win.payload?.filterIntegration === "string"
    ? win.payload.filterIntegration : null;
  const hasFilter = !!filterLayer || !!filterQuery || !!filterIntegration;

  if (!userId || (!loading && !snapshot)) {
    return (
      <div className="pointer-events-none flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
        <Network size={18} strokeWidth={1} className="shrink-0 text-ink-35" aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
          {userId ? "no graph data" : "no user set"}
        </span>
      </div>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className="pointer-events-none flex h-full items-center justify-center px-4">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">…</span>
      </div>
    );
  }

  const { counts, totalEdges, recents } = snapshot!;
  const totalNodes = LAYER_ORDER.reduce((s, l) => s + (counts[l] ?? 0), 0);

  return (
    <div className="pointer-events-none flex h-full flex-col overflow-hidden">
      {/* Node / edge counts */}
      <div className="shrink-0 border-b border-rule px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">nodes</span>
          <span className="font-mono text-[11px] tabular-nums text-ink-90">{totalNodes}</span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">edges</span>
          <span className="font-mono text-[11px] tabular-nums text-ink-90">~{totalEdges}</span>
        </div>
      </div>

      {/* Per-layer breakdown */}
      <div className="shrink-0 border-b border-rule">
        {LAYER_ORDER.map((layer) => {
          const count = counts[layer] ?? 0;
          if (count === 0) return null;
          return (
            <div key={layer} className="flex items-center justify-between border-b border-rule/60 px-3 py-1 last:border-b-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", LAYER_DOT[layer])} />
                <span className="font-mono text-[10px] text-ink-60">{layer}</span>
              </div>
              <span className="font-mono text-[10px] tabular-nums text-ink-90">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Recent nodes */}
      {recents.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="border-b border-rule/60 px-3 pb-1 pt-2">
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">recent</span>
          </div>
          <div>
            {recents.map((node) => (
              <div key={node.id} className="flex items-start gap-1.5 border-b border-rule/40 px-3 py-1 last:border-b-0">
                <span aria-hidden className={cn("mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full", LAYER_DOT[node.layer])} />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] leading-snug text-ink-60">
                  {node.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {hasFilter && (
        <div className="shrink-0 border-t border-rule px-3 py-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">filter</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {filterLayer && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-accent-indigo/30 bg-accent-indigo-soft px-1.5 py-0.5 font-mono text-[9px] text-accent-indigo">
                {filterLayer}
              </span>
            )}
            {filterIntegration && (
              <span className="inline-flex rounded-sm border border-accent-indigo/30 bg-accent-indigo-soft px-1.5 py-0.5 font-mono text-[9px] text-accent-indigo">
                {filterIntegration}
              </span>
            )}
            {filterQuery && (
              <span className="inline-flex rounded-sm border border-rule bg-paper-2 px-1.5 py-0.5 font-mono text-[9px] text-ink-60">
                &ldquo;{filterQuery}&rdquo;
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
