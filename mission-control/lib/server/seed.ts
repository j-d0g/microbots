import "server-only";
import type { Agent, FeedKind, Level } from "@/lib/types";
import { addArtifact, addFeed, addMessage, createTask, getTask, patchAgent, patchTask, setFocus, setView, showWidgets, upsertAgent } from "./store";

const agents: Array<Pick<Agent, "id" | "name" | "role" | "goal" | "voice" | "color">> = [
  {
    id: "shepherd",
    name: "Shepherd",
    role: "chief of staff",
    goal: "Keep Jordan oriented and delegate focused work to the right arm.",
    voice: "verse",
    color: "#7dd3fc",
  },
  {
    id: "scout",
    name: "Scout",
    role: "research",
    goal: "Find reliable evidence and summarize technical options.",
    voice: "sage",
    color: "#22d3ee",
  },
  {
    id: "scribe",
    name: "Scribe",
    role: "drafting/writing",
    goal: "Turn notes and findings into concise, useful writing.",
    voice: "coral",
    color: "#f59e0b",
  },
  {
    id: "ops",
    name: "Ops",
    role: "checks/monitoring",
    goal: "Watch evaluations, traces, and reliability checks.",
    voice: "ash",
    color: "#a78bfa",
  },
];

export function seed(): void {
  const now = Date.now();
  const seededAgents: Agent[] = agents.map((agent, index) => ({
    ...agent,
    status: index === 1 ? "running" : index === 2 ? "review" : index === 3 ? "needs_you" : "idle",
    currentTaskId: null,
    lastLine: index === 1 ? "Comparing Pi's harness patterns with our runner." : index === 2 ? "Weekly update is ready for a pass." : index === 3 ? "Waiting on a direction for the fallback policy." : "Ready when you are.",
    tokens: index === 1 ? 1240 : index === 2 ? 890 : index === 3 ? 620 : 0,
    costUsd: index === 1 ? 0.0031 : index === 2 ? 0.0018 : index === 3 ? 0.0012 : 0,
    createdAt: now - (agents.length - index) * 60_000,
    updatedAt: now,
  }));
  seededAgents.forEach(upsertAgent);

  const task1 = createTask({
    title: "Summarise last night's Cody2 eval failures",
    description: "Group the regressions by failure mode and call out likely causes.",
    status: "done",
    priority: "p1",
    agentId: "scout",
  });
  const task2 = createTask({
    title: "Research Pi agent harness design",
    description: "Compare the control loop, tool handling, and recovery patterns with our harness.",
    status: "doing",
    priority: "p1",
    agentId: "scout",
  });
  const task3 = createTask({
    title: "Draft the weekly harness update",
    description: "Summarize eval health, shipped fixes, and this week's risks.",
    status: "review",
    priority: "p2",
    agentId: "scribe",
  });
  const task4 = createTask({
    title: "Check PostHog traces for failed turns",
    description: "Look for recurring tool timeouts and mismatches between retries and final outcomes.",
    status: "backlog",
    priority: "p1",
    agentId: "ops",
  });
  const task5 = createTask({
    title: "Choose a safe fallback for interrupted tool turns",
    description: "Decide how the runner should recover when a tool call times out mid-turn.",
    status: "doing",
    priority: "p0",
    agentId: "ops",
  });
  const task6 = createTask({
    title: "Reproduce the timeout on the tool-retry eval",
    description: "Capture the failing trace and confirm the retry boundary.",
    status: "todo",
    priority: "p1",
    agentId: "ops",
  });
  const task7 = createTask({
    title: "Review the new JSON repair prompt",
    description: "Check output validity and whether repair changes user intent.",
    status: "done",
    priority: "p2",
    agentId: "scribe",
  });
  createTask({
    title: "Audit token and cost tracking on multi-step runs",
    description: "Confirm every model step is attributed to the correct arm and run.",
    status: "todo",
    priority: "p2",
    agentId: "scout",
  });

  patchTask(task5.id, {
    ask: {
      question: "Which recovery should the harness try first after a tool timeout?",
      options: [
        "Retry once with the same arguments",
        "Ask the model to repair the call",
        "Stop and request human review",
      ],
      askedAt: now - 4 * 60_000,
      answer: null,
    },
  });
  patchAgent("scout", { currentTaskId: task2.id });
  patchAgent("scribe", { currentTaskId: task3.id });
  patchAgent("ops", { currentTaskId: task5.id });

  const artifact = addArtifact({
    taskId: task1.id,
    agentId: "scout",
    title: "Cody2 eval failure notes",
    content: "## Overnight readout\n\nMost failures cluster around slow tool responses and malformed retries. The next useful check is to compare retry timing with the final turn outcome.",
  });
  const completed = getTask(task1.id);
  if (completed) patchTask(task1.id, { artifactIds: [...completed.artifactIds, artifact.id] });

  setFocus({
    items: [
      { title: "Unblock tool-timeout recovery", why: "The retry policy affects several flaky harness evals.", taskId: task5.id },
      { title: "Compare Pi harness patterns", why: "Identify one or two reusable ideas before the next runner change.", taskId: task2.id },
      { title: "Close the loop on overnight failures", why: "Turn the Cody2 regressions into a small, testable fix list.", taskId: task1.id },
    ],
    recommendations: [
      { title: "Review the fallback choices", why: "Ops is waiting for a direction.", prompt: "Let's choose the fallback for interrupted tool turns." },
      { title: "Check the failed-turn traces", why: "Find out whether retries are masking a timeout issue.", prompt: "Check PostHog traces for failed turns." },
      { title: "Draft a short update", why: "Share the evaluation status with the team.", prompt: "Draft the weekly harness update." },
    ],
  });

  const activity: Array<{ kind: FeedKind; level: Level; agentId: string | null; title: string; body: string; data?: Record<string, unknown> }> = [
    { kind: "notification", level: "important", agentId: "shepherd", title: "Morning brief ready", body: "Three priorities are lined up for today." },
    { kind: "log", level: "info", agentId: "ops", title: "Eval batch started", body: "Cody2 nightly checks entered review." },
    { kind: "tool", level: "info", agentId: "scout", title: "search", body: "Found three notes on agent harness recovery.", data: { tool: "search", input: "Pi agent harness recovery", output: "3 results", ok: true, ms: 418 } },
    { kind: "llm", level: "info", agentId: "scout", title: "openai:gpt-5-mini step 0", body: "820 input · 211 output tokens", data: { model: "openai:gpt-5-mini", inputTokens: 820, outputTokens: 211, ms: 1150, costUsd: 0.000627, step: 0 } },
    { kind: "log", level: "info", agentId: "ops", title: "Retry budget reached", body: "One failed turn exhausted its retry budget." },
    { kind: "tool", level: "info", agentId: "ops", title: "read_trace", body: "Loaded the failed-turn trace.", data: { tool: "read_trace", input: "run 18", output: "timeout after tool response", ok: true, ms: 231 } },
    { kind: "notification", level: "urgent", agentId: "ops", title: "Decision needed", body: "Ops is waiting on the fallback policy." },
    { kind: "llm", level: "info", agentId: "scribe", title: "openai:gpt-5-mini step 1", body: "462 input · 158 output tokens", data: { model: "openai:gpt-5-mini", inputTokens: 462, outputTokens: 158, ms: 890, costUsd: 0.0004315, step: 1 } },
    { kind: "log", level: "info", agentId: "scout", title: "Harness notes updated", body: "Recovery and tool-loop details added to the comparison." },
    { kind: "tool", level: "info", agentId: "scribe", title: "write_artifact", body: "Weekly update draft saved.", data: { tool: "write_artifact", input: "weekly update", output: "artifact created", ok: true, ms: 12 } },
    { kind: "notification", level: "important", agentId: "scribe", title: "Draft ready for review", body: "The weekly harness update is ready." },
    { kind: "llm", level: "info", agentId: "ops", title: "openai:gpt-5-mini step 0", body: "615 input · 93 output tokens", data: { model: "openai:gpt-5-mini", inputTokens: 615, outputTokens: 93, ms: 702, costUsd: 0.0003405, step: 0 } },
    { kind: "log", level: "info", agentId: "scout", title: "Cody2 summary completed", body: "Overnight failures grouped by tool timeout and retry mismatch." },
    { kind: "tool", level: "info", agentId: "scout", title: "write_artifact", body: "Cody2 eval failure notes saved.", data: { tool: "write_artifact", input: "eval failures", output: "artifact created", ok: true, ms: 18 } },
    { kind: "notification", level: "info", agentId: "shepherd", title: "Mission Control is live", body: "Agents and tasks are ready for today's work." },
  ];
  activity.forEach((event, index) => addFeed({
    ...event,
    taskId: index === 6 ? task5.id : null,
    runId: event.kind === "llm" || event.kind === "tool" ? `run_seed_${Math.floor(index / 4)}` : null,
    ts: now - (activity.length - index) * 45_000,
    data: event.data ?? null,
  }));

  addMessage({ role: "user", agentId: "shepherd", text: "What should I focus on today?" });
  addMessage({ role: "assistant", agentId: "shepherd", text: "First, unblock the timeout fallback. Then finish the Pi harness comparison and turn last night's failures into a short fix list." });

  showWidgets([
    {
      kind: "brief",
      title: "Today's brief",
      bullets: [
        "Pick a recovery policy for interrupted tool calls.",
        "Compare Pi's harness loop with our retry behavior.",
        "Turn Cody2's overnight failures into a focused fix list.",
      ],
    },
    {
      kind: "stats",
      title: "Harness pulse",
      items: [
        { label: "Open tasks", value: "6", delta: "2 in progress", tone: "warn" },
        { label: "Overnight evals", value: "94.2%", delta: "−1.8 pts", tone: "bad" },
        { label: "Arms active", value: "3", delta: "1 needs you", tone: "good" },
      ],
    },
  ], "replace");
  setView("stage");
}
