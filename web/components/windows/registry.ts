/** Display labels and concise agent-facing summaries for canvas cards. */

import type { AgentStoreState, WindowKind, WindowState } from "@/lib/store";

export interface WindowModule {
  title: string;
  summary: (state: AgentStoreState, win?: WindowState) => string;
}

const truncate = (s: string, max = 80) =>
  s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "\u2026";

export const WINDOW_REGISTRY: Record<WindowKind, WindowModule> = {
  graph: {
    title: "graph",
    summary: () => truncate(`knowledge graph · context window`),
  },
  ask_user: {
    title: "ask_user",
    summary: (_s, win) => {
      const question = (win?.payload?.question as string) ?? "";
      return truncate(`ask_user · "${question}"`);
    },
  },
  integrations: {
    title: "integrations",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      return truncate(`integrations · ${count} connected`);
    },
  },

  integration_detail: {
    title: "integration_detail",
    summary: (_s, win) => {
      const slug = (win?.payload?.slug as string) ?? "?";
      return truncate(`integration · ${slug}`);
    },
  },

  entities: {
    title: "entities",
    summary: (_s, win) => {
      const type = (win?.payload?.entity_type as string) ?? "all";
      const count = (win?.payload?.count as number) ?? 0;
      return truncate(`entities · type=${type} · ${count}`);
    },
  },

  entity_detail: {
    title: "entity_detail",
    summary: (_s, win) => {
      const name = (win?.payload?.name as string) ?? "?";
      const type = (win?.payload?.entity_type as string) ?? "";
      return truncate(`entity · ${name}${type ? ` (${type})` : ""}`);
    },
  },

  memories: {
    title: "memories",
    summary: (_s, win) => {
      const by = (win?.payload?.by as string) ?? "confidence";
      const count = (win?.payload?.count as number) ?? 0;
      return truncate(`memories · ${count} · by ${by}`);
    },
  },

  skills: {
    title: "skills",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      const min = (win?.payload?.min_strength as number) ?? 1;
      return truncate(`skills · ${count} · min strength ${min}`);
    },
  },

  workflows: {
    title: "workflows",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      const sel = (win?.payload?.slug as string) ?? null;
      return truncate(
        sel ? `workflow · ${sel}` : `workflows · ${count} saved`,
      );
    },
  },

  today: {
    title: "today",
    summary: (_s, win) => {
      const needs = (win?.payload?.needs_you as unknown[])?.length ?? 0;
      const suggestions = (win?.payload?.suggestions as unknown[])?.length ?? 0;
      return truncate(`today · ${needs} needs you · ${suggestions} suggestions`);
    },
  },

  composio_connect: {
    title: "composio_connect",
    summary: (state) => {
      const active = state.connections.filter((c) => c.status === "ACTIVE").length;
      const total = state.toolkits.length;
      return truncate(`connect integrations · ${active}/${total > 0 ? total : "?"} active`);
    },
  },
};

export const WINDOW_LABEL: Record<WindowKind, string> = {
  graph: "graph",
  ask_user: "ask user",
  integrations: "integrations",
  integration_detail: "integration",
  entities: "entities",
  entity_detail: "entity",
  memories: "memories",
  skills: "skills",
  workflows: "workflows",
  today: "today",
  composio_connect: "connect integrations",
};

/** Returns the kind identifiers as a plain array. */
export function listWindowKinds(): WindowKind[] {
  return Object.keys(WINDOW_REGISTRY) as WindowKind[];
}
