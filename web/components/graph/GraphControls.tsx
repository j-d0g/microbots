"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { type GraphFilter, LAYERS_ORDER } from "./types";
import type { NodeLayer } from "@/lib/seed/types";

interface Props {
  filter: GraphFilter;
  onFilterLayer: (layer: NodeLayer | null) => void;
  onSearch: (q: string) => void;
  compact: boolean;
  /* metrics */
  visibleNodes: number;
  totalNodes: number;
}

const LAYER_ABBR: Record<NodeLayer, string> = {
  user: "u",
  integration: "int",
  entity: "ent",
  memory: "mem",
  skill: "skl",
  workflow: "wf",
};

export function GraphControls({
  filter,
  onFilterLayer,
  onSearch,
  compact,
  visibleNodes,
  totalNodes,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState(filter.query);

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-2">
      <div className="pointer-events-auto">
        <div
          className={cn(
            "flex items-center gap-0.5 rounded-md border border-rule",
            "bg-paper-0/85 px-1.5 py-1 backdrop-blur-md",
            "shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
          )}
        >
          {/* Layer chips */}
          <FilterChip
            active={filter.layer === null}
            label="all"
            onClick={() => onFilterLayer(null)}
          />
          {LAYERS_ORDER.map((layer) => (
            <FilterChip
              key={layer}
              active={filter.layer === layer}
              label={compact ? LAYER_ABBR[layer] : layer}
              onClick={() => onFilterLayer(layer)}
            />
          ))}

          {/* Divider */}
          <span className="mx-1 h-3 w-px bg-rule" />

          {/* Node count */}
          <span className="px-1 font-mono text-[10px] uppercase tracking-wider text-ink-35">
            {visibleNodes === totalNodes ? (
              <span>{totalNodes}</span>
            ) : (
              <>
                <span className="text-ink-90">{visibleNodes}</span>
                <span className="text-ink-35/60">/{totalNodes}</span>
              </>
            )}
          </span>

          {/* Search toggle */}
          <button
            type="button"
            aria-label={searchOpen ? "close search" : "open search"}
            title="search"
            onClick={() => setSearchOpen((v) => !v)}
            className={cn(
              "ml-0.5 flex h-5 w-5 items-center justify-center rounded transition-colors",
              searchOpen
                ? "bg-accent-indigo/8 text-accent-indigo"
                : "text-ink-60 hover:bg-paper-2 hover:text-ink-90",
            )}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" />
              <line x1="6.7" y1="6.7" x2="9.5" y2="9.5" stroke="currentColor" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {searchOpen && (
          <motion.input
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              onSearch(e.target.value);
            }}
            placeholder="filter nodes…"
            className={cn(
              "pointer-events-auto rounded-md border border-rule bg-paper-0/95 px-2 py-1.5",
              "font-mono text-[11px] text-ink-90 placeholder-ink-35 outline-none focus:border-accent-indigo/60",
              compact ? "w-[180px]" : "w-[220px]",
            )}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
        active
          ? "bg-accent-indigo/8 text-accent-indigo"
          : "text-ink-60 hover:bg-paper-2 hover:text-ink-90",
      )}
    >
      {label}
    </button>
  );
}
