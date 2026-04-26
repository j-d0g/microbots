import type { WindowKind } from "@/lib/store";

/** Friendly labels used in the stage chrome. Lower-case, no underscores. */
export const WINDOW_LABEL: Record<WindowKind, string> = {
  run_code: "run code",
  save_workflow: "save workflow",
  view_workflow: "workflow",
  run_workflow: "run workflow",
  list_workflows: "workflows",
  find_examples: "examples",
  search_memory: "memory",
  ask_user: "ask",
  graph: "graph",
  settings: "settings",
  chat: "chat",
};

/** Single-line summary used on sideline thumbnails — kept tiny on
 *  purpose; the role of a sideline is to remind you it's there, not
 *  to show its full state. The agent can override per-window. */
export const WINDOW_SIDELINE_HINT: Record<WindowKind, string> = {
  run_code: "scratchpad",
  save_workflow: "save",
  view_workflow: "recipe",
  run_workflow: "run",
  list_workflows: "saved",
  find_examples: "examples",
  search_memory: "memory",
  ask_user: "agent question",
  graph: "ontology",
  settings: "preferences",
  chat: "transcript",
};
