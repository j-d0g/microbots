import type { WindowKind } from "@/lib/store";

/** Friendly labels used in the stage chrome. Lower-case, no underscores. */
export const WINDOW_LABEL: Record<WindowKind, string> = {
  graph: "graph",
  chat: "chat",
  ask_user: "ask",
  settings: "settings",
  profile: "profile",
  integrations: "integrations",
  integration_detail: "integration",
  entities: "entities",
  entity_detail: "entity",
  memories: "memories",
  skills: "skills",
  workflows: "workflows",
  wiki: "wiki",
  chats_summary: "chats",
};

/** Single-line summary used on sideline thumbnails — kept tiny on
 *  purpose; the role of a sideline is to remind you it's there, not
 *  to show its full state. The agent can override per-window. */
export const WINDOW_SIDELINE_HINT: Record<WindowKind, string> = {
  graph: "ontology",
  chat: "transcript",
  ask_user: "agent question",
  settings: "preferences",
  profile: "you",
  integrations: "connected apps",
  integration_detail: "app · detail",
  entities: "people & things",
  entity_detail: "entity · detail",
  memories: "facts",
  skills: "capabilities",
  workflows: "playbooks",
  wiki: "knowledge",
  chats_summary: "signal heatmap",
};
