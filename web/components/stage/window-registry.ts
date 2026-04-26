/**
 * The contract teammates fill in for every window kind.
 *
 * `summary` is the **only** thing the agent sees about what's inside
 * a window — keep it ≤ 80 chars, present-tense, factual. No marketing
 * copy. Reads from the same Zustand store the window itself uses.
 *
 * `defaultMount` is the layout-agent's hint for where to put a freshly
 * opened window when no other constraint applies.
 *
 * `mcpUrl` is a placeholder for when teammates expose per-window MCPs
 * to the agent for in-window content actions. Empty for now.
 *
 * Plan reference: `microbots_text_canvas_representation` §2b + §10.
 */

import type { AgentStoreState, RoomKind, WindowState } from "@/lib/store";
import { seed } from "@/lib/seed/ontology";
import type { MountPoint } from "@/lib/agent/types";

export interface WindowModule {
  /** Short label shown in the title bar AND fed to the agent. */
  title: string;
  /** ≤ 80 chars, factual, present-tense.
   *  Style examples (good):
   *    "5 services · gmail-distiller in WARN, others green"
   *    "3 proposals queued, awaiting approval; bug-triage at top"
   *  Style examples (bad):
   *    "Welcome to your brief!"            (marketing)
   *    "Stuff and things going on here"    (vague)
   *
   *  Receives the live window when called via `snapshotWindow` so
   *  per-instance kinds (e.g. integration windows keyed by slug) can
   *  specialise their summary. Optional for back-compat. */
  summary: (state: AgentStoreState, win?: WindowState) => string;
  defaultMount?: MountPoint;
  /** Reserved. Teammates plug in real MCP URLs once their servers are
   *  online; the agent will treat each window as a callable tool host. */
  mcpUrl?: string;
}

const truncate = (s: string, max = 80) =>
  s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";

export const WINDOW_REGISTRY: Record<RoomKind, WindowModule> = {
  brief: {
    title: "brief",
    defaultMount: "full",
    summary: () => {
      const ps = seed.briefProposals;
      const top = ps[0]?.title.toLowerCase() ?? "(none)";
      const high = ps.filter((p) => p.confidence >= 0.9).length;
      return truncate(
        `${ps.length} proposals queued · ${high} high-confidence · top: ${top}`,
      );
    },
  },

  graph: {
    title: "graph",
    defaultMount: "full",
    summary: () => {
      const nodes = seed.nodes.length;
      const edges = seed.edges.length;
      const integrations = seed.nodes.filter((n) => n.layer === "integration").length;
      const memories = seed.nodes.filter((n) => n.layer === "memory").length;
      return truncate(
        `${nodes} nodes · ${edges} edges · ${integrations} integrations · ${memories} memories`,
      );
    },
  },

  workflow: {
    title: "workflows",
    defaultMount: "left-half",
    summary: () => {
      const ws = seed.workflows;
      const live = ws.filter((w) => w.confidence >= seed.confidenceThreshold).length;
      const top = [...ws].sort((a, b) => b.runsLast7d - a.runsLast7d)[0];
      return truncate(
        `${ws.length} workflows · ${live} above threshold · top: ${top?.title ?? "—"} (${top?.runsLast7d ?? 0}/7d)`,
      );
    },
  },

  stack: {
    title: "stack",
    defaultMount: "right-half",
    summary: () => {
      const ss = seed.services;
      const down = ss.filter((s) => s.health === "down");
      const warn = ss.filter((s) => s.health === "warn");
      const note =
        down.length > 0
          ? `${down[0].slug} DOWN`
          : warn.length > 0
            ? `${warn[0].slug} in WARN`
            : "all green";
      return truncate(`${ss.length} services · ${note}`);
    },
  },

  waffle: {
    title: "waffle",
    defaultMount: "center-third",
    summary: (s) => {
      const speaking = s.dock === "speaking" || s.dock === "listening";
      const len = s.transcript.length;
      return truncate(
        speaking
          ? `recording · ${len} chars captured · dock=${s.dock}`
          : `idle · waiting for the user to talk`,
      );
    },
  },

  playbooks: {
    title: "playbooks",
    defaultMount: "full",
    summary: () => {
      const o = seed.playbooks.org.length;
      const n = seed.playbooks.network.length;
      const sg = seed.playbooks.suggested.length;
      return truncate(
        `${o + n + sg} playbooks · ${o} org · ${n} network · ${sg} suggested for Maya`,
      );
    },
  },

  settings: {
    title: "settings",
    defaultMount: "right-wide",
    summary: (state) => {
      const userId = state.userId ?? null;
      const conn = state.connections.filter((c) => c.status === "ACTIVE").length;
      const total = state.connections.length;
      if (!userId) return truncate(`user_id NOT SET · enter one to use the app`);
      return truncate(
        `user_id=${userId} · ${conn}/${total || "?"} integrations active`,
      );
    },
  },

  integration: {
    title: "integration",
    defaultMount: "right-half",
    summary: (state, win) => {
      const slug = (win?.payload?.slug as string | undefined) ?? "?";
      const status =
        state.connections.find((c) => c.slug === slug)?.status ?? "not-connected";
      return truncate(`integration ${slug} · ${status}`);
    },
  },
};

/** Returns the kind identifiers as a plain array — used by the agent
 *  layer to derive the `open_window.kind` enum at runtime so newly
 *  registered kinds are immediately reachable. */
export function listWindowKinds(): RoomKind[] {
  return Object.keys(WINDOW_REGISTRY) as RoomKind[];
}
