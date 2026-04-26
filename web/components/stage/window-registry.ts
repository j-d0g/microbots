/**
 * V1 Window Registry — the 10 window kinds.
 *
 * Each entry maps a `WindowKind` to its display metadata. The 8 harness
 * tools + graph + settings. Old kinds (brief, workflow, stack, waffle,
 * playbooks, integration) are removed entirely.
 *
 * `summary` is the **only** thing the agent sees about what's inside
 * a window — keep it <= 80 chars, present-tense, factual.
 *
 * `windowType`: "tool" windows are ephemeral traces of tool calls;
 * "context" windows persist across agent turns.
 */

import type { AgentStoreState, WindowKind, WindowState } from "@/lib/store";
import type { MountPoint } from "@/lib/agent/types";

export interface WindowModule {
  /** Short label shown in the title bar AND fed to the agent. */
  title: string;
  /** "tool" = ephemeral trace of a tool call. "context" = persists. */
  windowType: "tool" | "context";
  /** Whether the user can pin this window. */
  pinnable: boolean;
  /** <= 80 chars, factual, present-tense. */
  summary: (state: AgentStoreState, win?: WindowState) => string;
  defaultMount?: MountPoint;
}

const truncate = (s: string, max = 80) =>
  s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "\u2026";

export const WINDOW_REGISTRY: Record<WindowKind, WindowModule> = {
  run_code: {
    title: "run_code",
    windowType: "tool",
    pinnable: true,
    defaultMount: "left-half",
    summary: (_s, win) => {
      const code = (win?.payload?.code as string) ?? "";
      const status = (win?.payload?.status as string) ?? "pending";
      return truncate(`run_code \u00b7 ${status} \u00b7 ${code.length} chars`);
    },
  },

  save_workflow: {
    title: "save_workflow",
    windowType: "tool",
    pinnable: true,
    defaultMount: "center-third",
    summary: (_s, win) => {
      const name = (win?.payload?.name as string) ?? "untitled";
      const status = (win?.payload?.status as string) ?? "pending";
      return truncate(`save_workflow \u00b7 ${name} \u00b7 ${status}`);
    },
  },

  view_workflow: {
    title: "view_workflow",
    windowType: "tool",
    pinnable: true,
    defaultMount: "left-half",
    summary: (_s, win) => {
      const name = (win?.payload?.name as string) ?? "?";
      return truncate(`view_workflow \u00b7 ${name}`);
    },
  },

  run_workflow: {
    title: "run_workflow",
    windowType: "tool",
    pinnable: true,
    defaultMount: "left-half",
    summary: (_s, win) => {
      const name = (win?.payload?.name as string) ?? "?";
      const status = (win?.payload?.status as string) ?? "pending";
      return truncate(`run_workflow \u00b7 ${name} \u00b7 ${status}`);
    },
  },

  list_workflows: {
    title: "list_workflows",
    windowType: "tool",
    pinnable: true,
    defaultMount: "right-half",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      return truncate(`list_workflows \u00b7 ${count} workflows`);
    },
  },

  find_examples: {
    title: "find_examples",
    windowType: "tool",
    pinnable: true,
    defaultMount: "full",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      const query = (win?.payload?.query as string) ?? "";
      return truncate(`find_examples \u00b7 ${count} matches \u00b7 q="${query}"`);
    },
  },

  search_memory: {
    title: "search_memory",
    windowType: "tool",
    pinnable: true,
    defaultMount: "right-half",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      const query = (win?.payload?.query as string) ?? "";
      return truncate(`search_memory \u00b7 ${count} results \u00b7 q="${query}"`);
    },
  },

  ask_user: {
    title: "ask_user",
    windowType: "tool",
    pinnable: false,
    defaultMount: "center-third",
    summary: (_s, win) => {
      const question = (win?.payload?.question as string) ?? "";
      return truncate(`ask_user \u00b7 "${question}"`);
    },
  },

  graph: {
    title: "graph",
    windowType: "context",
    pinnable: true,
    defaultMount: "full",
    summary: (state) => {
      return truncate(`knowledge graph \u00b7 context window`);
    },
  },

  settings: {
    title: "settings",
    windowType: "context",
    pinnable: true,
    defaultMount: "right-wide",
    summary: (state) => {
      const userId = state.userId ?? null;
      const orgId = state.orgId ?? null;
      const conn = state.connections.filter((c) => c.status === "ACTIVE").length;
      if (!userId) return truncate(`user_id NOT SET \u00b7 enter one to use the app`);
      return truncate(
        `user_id=${userId}${orgId ? ` \u00b7 org=${orgId}` : ""} \u00b7 ${conn} integrations active`,
      );
    },
  },
};

/** Returns the kind identifiers as a plain array. */
export function listWindowKinds(): WindowKind[] {
  return Object.keys(WINDOW_REGISTRY) as WindowKind[];
}
