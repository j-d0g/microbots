/**
 * Schema-driven window registry (v2).
 *
 * Each entry maps a `WindowKind` to its display metadata. Every kind
 * is either a cross-cutting UX primitive (`graph`, `chat`, `ask_user`,
 * `settings`) or backed by an endpoint in the KG ↔ Frontend contract.
 *
 * `summary` is the **only** thing the agent sees about what's inside
 * a window — keep it ≤ 80 chars, present-tense, factual.
 *
 * `windowType`: "tool" windows are ephemeral traces of tool calls;
 * "context" windows persist across agent turns. Schema-backed kinds
 * are mostly "context" since they reflect long-lived KG state.
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
  /** ≤ 80 chars, factual, present-tense. */
  summary: (state: AgentStoreState, win?: WindowState) => string;
  defaultMount?: MountPoint;
}

const truncate = (s: string, max = 80) =>
  s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "\u2026";

export const WINDOW_REGISTRY: Record<WindowKind, WindowModule> = {
  /* ---------- cross-cutting ---------- */
  graph: {
    title: "graph",
    windowType: "context",
    pinnable: true,
    defaultMount: "full",
    summary: () => truncate(`knowledge graph · context window`),
  },

  chat: {
    title: "chat",
    windowType: "context",
    pinnable: true,
    defaultMount: "right-half",
    summary: (state) => {
      const n = state.chatMessages.length;
      if (n === 0) return truncate(`chat · no history yet`);
      const last = state.chatMessages[n - 1];
      const role = last.role === "user" ? "you" : "agent";
      return truncate(`chat · ${n} msgs · last: ${role} · ${last.text.slice(0, 40)}`);
    },
  },

  ask_user: {
    title: "ask_user",
    windowType: "tool",
    pinnable: false,
    defaultMount: "center-third",
    summary: (_s, win) => {
      const question = (win?.payload?.question as string) ?? "";
      return truncate(`ask_user · "${question}"`);
    },
  },

  settings: {
    title: "settings",
    windowType: "context",
    pinnable: true,
    defaultMount: "right-wide",
    summary: (state) => {
      const userId = state.userId ?? null;
      const conn = state.connections.filter((c) => c.status === "ACTIVE").length;
      if (!userId) return truncate(`user_id NOT SET · enter one to use the app`);
      return truncate(`user_id=${userId} · ${conn} integrations active`);
    },
  },

  /* ---------- schema-backed ---------- */
  profile: {
    title: "profile",
    windowType: "context",
    pinnable: true,
    defaultMount: "right-wide",
    summary: (_s, win) => {
      const name = (win?.payload?.name as string) ?? "";
      const role = (win?.payload?.role as string) ?? "";
      const cw = (win?.payload?.context_window as number) ?? 0;
      const head = name ? `${name}${role ? ` · ${role}` : ""}` : "user profile";
      return truncate(`profile · ${head}${cw ? ` · ctx=${cw}` : ""}`);
    },
  },

  integrations: {
    title: "integrations",
    windowType: "context",
    pinnable: true,
    defaultMount: "left-half",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      return truncate(`integrations · ${count} connected`);
    },
  },

  integration_detail: {
    title: "integration_detail",
    windowType: "context",
    pinnable: true,
    defaultMount: "right-half",
    summary: (_s, win) => {
      const slug = (win?.payload?.slug as string) ?? "?";
      return truncate(`integration · ${slug}`);
    },
  },

  entities: {
    title: "entities",
    windowType: "context",
    pinnable: true,
    defaultMount: "right-half",
    summary: (_s, win) => {
      const type = (win?.payload?.entity_type as string) ?? "all";
      const count = (win?.payload?.count as number) ?? 0;
      return truncate(`entities · type=${type} · ${count}`);
    },
  },

  entity_detail: {
    title: "entity_detail",
    windowType: "context",
    pinnable: true,
    defaultMount: "center-third",
    summary: (_s, win) => {
      const name = (win?.payload?.name as string) ?? "?";
      const type = (win?.payload?.entity_type as string) ?? "";
      return truncate(`entity · ${name}${type ? ` (${type})` : ""}`);
    },
  },

  memories: {
    title: "memories",
    windowType: "context",
    pinnable: true,
    defaultMount: "right-half",
    summary: (_s, win) => {
      const by = (win?.payload?.by as string) ?? "confidence";
      const count = (win?.payload?.count as number) ?? 0;
      return truncate(`memories · ${count} · by ${by}`);
    },
  },

  skills: {
    title: "skills",
    windowType: "context",
    pinnable: true,
    defaultMount: "left-half",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      const min = (win?.payload?.min_strength as number) ?? 1;
      return truncate(`skills · ${count} · min strength ${min}`);
    },
  },

  workflows: {
    title: "workflows",
    windowType: "context",
    pinnable: true,
    defaultMount: "full",
    summary: (_s, win) => {
      const count = (win?.payload?.count as number) ?? 0;
      const sel = (win?.payload?.slug as string) ?? null;
      return truncate(
        sel ? `workflow · ${sel}` : `workflows · ${count} saved`,
      );
    },
  },

  wiki: {
    title: "wiki",
    windowType: "context",
    pinnable: true,
    defaultMount: "full",
    summary: (_s, win) => {
      const path = (win?.payload?.path as string) ?? "";
      return truncate(path ? `wiki · ${path}` : `wiki · index`);
    },
  },

  chats_summary: {
    title: "chats_summary",
    windowType: "context",
    pinnable: true,
    defaultMount: "right-half",
    summary: (_s, win) => {
      const total = (win?.payload?.total as number) ?? 0;
      return truncate(`chats · ${total} signals`);
    },
  },

  composio_connect: {
    title: "composio_connect",
    windowType: "context",
    pinnable: true,
    defaultMount: "center-third",
    summary: (state) => {
      const active = state.connections.filter((c) => c.status === "ACTIVE").length;
      const total = state.toolkits.length;
      return truncate(`connect integrations · ${active}/${total > 0 ? total : "?"} active`);
    },
  },
};

/** Returns the kind identifiers as a plain array. */
export function listWindowKinds(): WindowKind[] {
  return Object.keys(WINDOW_REGISTRY) as WindowKind[];
}
