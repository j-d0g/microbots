// Shared contract between server (lib/server/*) and client (components/*, lib/client/*).

export type AgentStatus = "idle" | "running" | "needs_you" | "review";

export interface Agent {
  id: string; // "shepherd" is reserved for the orchestrator
  name: string;
  role: string; // one line: what this arm is for
  goal: string; // standing goal, fed to its system prompt
  voice: string; // OpenAI TTS voice id (alloy, ash, coral, sage, verse, ...)
  color: string; // hex accent used on cards / feed chips
  status: AgentStatus;
  currentTaskId: string | null;
  lastLine: string | null; // latest one-line status for the board card
  tokens: number; // lifetime totals for observability
  costUsd: number;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus = "backlog" | "todo" | "doing" | "review" | "done";
export type Priority = "p0" | "p1" | "p2" | "p3";

export interface HumanAsk {
  question: string;
  options: string[]; // may be empty: free-text answer
  askedAt: number;
  answer: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  agentId: string | null;
  ask: HumanAsk | null; // set while the arm is blocked on Jordan
  result: string | null; // arm's completion summary
  artifactIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Artifact {
  id: string;
  taskId: string | null;
  agentId: string;
  title: string;
  content: string; // markdown
  createdAt: number;
}

export type FeedKind = "notification" | "log" | "tool" | "llm";
export type Level = "info" | "important" | "urgent";

export interface FeedEvent {
  id: string;
  ts: number;
  kind: FeedKind;
  level: Level;
  agentId: string | null;
  taskId: string | null;
  runId: string | null; // groups the steps of one agent run (a trace)
  title: string;
  body: string | null;
  // kind=tool: { tool, input, output, ok, ms }
  // kind=llm:  { model, inputTokens, outputTokens, ms, costUsd, step }
  data: Record<string, unknown> | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  agentId: string; // who spoke (shepherd, or an arm whose update was voiced)
  text: string;
  ts: number;
}

export interface FocusItem {
  title: string;
  why: string;
  taskId?: string;
}

export interface Recommendation {
  title: string;
  why: string;
  prompt: string; // what clicking it sends to the shepherd
}

export interface Focus {
  items: FocusItem[]; // today's priorities, ordered
  recommendations: Recommendation[];
  updatedAt: number;
}

export type View = "stage" | "agents" | "tasks";

export interface StageWidget {
  id: string;
  createdAt: number;
  widget: import("./widgets").Widget;
}

export interface Stage {
  view: View; // which centre tab the shepherd wants shown
  widgets: StageWidget[]; // newest last, capped at 6
}

export interface Snapshot {
  agents: Agent[];
  tasks: Task[];
  artifacts: Artifact[];
  feed: FeedEvent[]; // newest last, last 300
  messages: ChatMessage[]; // last 100
  focus: Focus;
  stage: Stage;
  demo: boolean; // true when running on the scripted demo model
  model: string; // e.g. "openai:gpt-5-mini" or "demo"
  voice: { tts: boolean; stt: boolean }; // server-side OpenAI voice available
}

// What the shepherd wants said out loud. The client decides how, per attention mode.
export interface SpeakRequest {
  id: string;
  agentId: string;
  text: string; // full line
  gist: string; // <= 12 words, used in focus mode
  level: Level;
  fast: boolean; // casual line -> faster TTS
}

export type BusEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "agent"; agent: Agent }
  | { type: "task"; task: Task }
  | { type: "task_deleted"; id: string }
  | { type: "artifact"; artifact: Artifact }
  | { type: "feed"; event: FeedEvent }
  | { type: "message"; message: ChatMessage }
  | { type: "focus"; focus: Focus }
  | { type: "stage"; stage: Stage }
  | { type: "speak"; speak: SpeakRequest }
  | { type: "thinking"; agentId: string; on: boolean };
