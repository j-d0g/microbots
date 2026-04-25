"use client";

import { cn } from "@/lib/cn";
import { LAYER_INK, LAYERS_ORDER } from "./types";
import type { NodeLayer } from "@/lib/seed/types";

interface Props {
  compact?: boolean;
  active: NodeLayer | null;
  onPick: (layer: NodeLayer | null) => void;
}

const SHORT_LABEL: Record<NodeLayer, string> = {
  user: "user",
  integration: "integration",
  entity: "entity",
  memory: "memory",
  skill: "skill",
  workflow: "workflow",
};

export function GraphLegend({ compact = false, active, onPick }: Props) {
  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-3 left-3 z-10",
        "rounded-md border border-rule bg-paper-0/85 backdrop-blur-md",
        "shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
        compact ? "px-1.5 py-1" : "px-2 py-1",
      )}
    >
      <div className={cn("flex items-center", compact ? "gap-1.5" : "gap-2")}>
        {LAYERS_ORDER.map((layer) => {
          const isActive = active === layer;
          const dim = active && !isActive;
          return (
            <button
              type="button"
              key={layer}
              title={layer}
              onClick={() => onPick(isActive ? null : layer)}
              className={cn(
                "flex items-center gap-1 rounded px-1 py-0.5 transition-opacity",
                "hover:bg-paper-2",
                dim && "opacity-40 hover:opacity-80",
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: LAYER_INK[layer] }}
              />
              {!compact && (
                <span
                  className={cn(
                    "font-mono text-[9px] uppercase tracking-wider",
                    isActive ? "text-ink-90" : "text-ink-35",
                  )}
                >
                  {SHORT_LABEL[layer]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
