import "server-only";
import { MockLanguageModelV3 } from "ai/test";
import type { Snapshot, Task } from "@/lib/types";

export type DemoScenario =
  | { kind: "shepherd"; userText: string; snapshot?: Snapshot }
  | { kind: "arm"; task: Task; answer?: string };

type ScriptCall = { toolName: string; input: Record<string, unknown> };
type ScriptContent =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string };

function normalized(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "'").trim();
}

function firstMatchingAsk(text: string, tasks: Task[]): Task | undefined {
  const value = normalized(text);
  return tasks.find((task) => {
    if (!task.ask || task.ask.answer !== null) return false;
    return task.ask.options.some((option) => {
      const candidate = normalized(option);
      return candidate.length > 8 && (value.includes(candidate) || candidate.includes(value));
    }) || /^(the )?(first|second|third|last|former|latter|option [1-3]|[1-3])\b/.test(value);
  });
}

function taskTitle(text: string): string {
  const trimmed = text.trim().replace(/[.!?]+$/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function briefWidgets(snapshot?: Snapshot): Array<Record<string, unknown>> {
  const tasks = snapshot?.tasks ?? [];
  const openTasks = tasks.filter((task) => task.status !== "done");
  const asks = tasks.filter((task) => task.ask && task.ask.answer === null);
  const priorities = snapshot?.focus.items.map((item) => item.title) ?? [];
  const bullets = (priorities.length ? priorities : openTasks.slice(0, 3).map((task) => task.title));
  return [
    {
      kind: "brief",
      title: "Today's brief",
      bullets: (bullets.length ? bullets : ["No priorities have been set yet."]).slice(0, 3),
    },
    {
      kind: "stats",
      title: "Mission pulse",
      items: [
        { label: "Open tasks", value: String(openTasks.length), tone: "neutral" },
        { label: "Agents active", value: String(snapshot?.agents.filter((agent) => agent.status === "running").length ?? 0), tone: "good" },
        { label: "Needs you", value: String(asks.length), tone: asks.length ? "warn" : "good" },
      ],
    },
  ];
}

function shepherdCalls(scenario: Extract<DemoScenario, { kind: "shepherd" }>): ScriptCall[] {
  const userText = scenario.userText;
  const text = normalized(userText);
  const snapshot = scenario.snapshot;
  const ask = firstMatchingAsk(userText, snapshot?.tasks ?? []);
  if (ask) return [{ toolName: "answer_ask", input: { taskId: ask.id, answer: userText } }];

  if (/\b(new agent|spawn)\b/.test(text)) {
    const name = userText.match(/\b(?:named|called)\s+([A-Z][\w-]*)\b/i)?.[1] ??
      userText.match(/\bnew agent\s+([A-Z][\w-]*)\b/)?.[1] ?? "Analyst";
    return [{ toolName: "spawn_agent", input: { name, role: "specialist", goal: userText, voice: "sage" } }];
  }
  if (/\b(status|brief|today|what'?s going on|priorit)\b/.test(text)) {
    const focus = snapshot?.focus ?? { items: [], recommendations: [] };
    return [
      { toolName: "show", input: { widgets: briefWidgets(snapshot), mode: "replace" } },
      { toolName: "set_focus", input: { items: focus.items, recommendations: focus.recommendations } },
    ];
  }
  if (/\b(tasks|kanban)\b/.test(text)) return [{ toolName: "navigate", input: { view: "tasks" } }];
  if (/\b(agents|team)\b/.test(text)) return [{ toolName: "navigate", input: { view: "agents" } }];
  if (/\b(research|look into|find)\b/.test(text)) {
    return [{ toolName: "create_task", input: { title: taskTitle(userText), description: userText, priority: "p1", agentId: "scout" } }];
  }
  if (/\b(write|draft|summar)\b/.test(text)) {
    return [{ toolName: "create_task", input: { title: taskTitle(userText), description: userText, priority: "p2", agentId: "scribe" } }];
  }
  if (/\b(check|monitor|watch)\b/.test(text)) {
    return [{ toolName: "create_task", input: { title: taskTitle(userText), description: userText, priority: "p1", agentId: "ops" } }];
  }
  if (/\b(decide|choose)\b/.test(text)) {
    return [{ toolName: "create_task", input: { title: taskTitle(userText), description: userText, priority: "p1", agentId: "scout" } }];
  }
  return [{ toolName: "show", input: { widgets: briefWidgets(snapshot), mode: "replace" } }];
}

function armCalls(scenario: Extract<DemoScenario, { kind: "arm" }>): ScriptCall[] {
  const task = scenario.task;
  const shouldAsk = !scenario.answer && /\b(decide|choose)\b|\?/.test(`${task.title} ${task.description}`.toLowerCase());
  if (shouldAsk) {
    return [{
      toolName: "ask_human",
      input: {
        question: `Which direction should I take for “${task.title}”?`,
        options: ["Fix the highest-impact eval first", "Prioritize the most reproducible failure", "Compare both before choosing"],
      },
    }];
  }
  const summary = scenario.answer
    ? `Applied your direction: ${scenario.answer}`
    : `Completed the first pass on ${task.title}.`;
  return [
    { toolName: "report_progress", input: { line: scenario.answer ? "Applying your direction and validating the result." : "Checking the evidence and preparing a concise readout." } },
    {
      toolName: "write_artifact",
      input: {
        title: `${task.title} — notes`,
        content: `## Summary\n\n${summary}\n\n## Next step\n\nReview the evidence and verify the change against the harness evals.`,
      },
    },
    { toolName: "complete_task", input: { summary } },
  ];
}

function outputText(scenario: DemoScenario): string {
  if (scenario.kind === "arm") return scenario.answer ? "I’ve applied your direction and finished the first pass." : "I’ve finished the first pass and left a short readout.";
  const text = normalized(scenario.userText);
  if (/\b(new agent|spawn)\b/.test(text)) return "I’ve added a new specialist and given them a clear starting goal.";
  if (/\b(status|brief|today|what'?s going on|priorit)\b/.test(text)) return "I’ve refreshed the stage and brought today’s priorities forward.";
  if (/\b(tasks|kanban)\b/.test(text)) return "I’ve opened the task board so you can see what’s moving.";
  if (/\b(agents|team)\b/.test(text)) return "I’ve brought the agent board into view.";
  if (firstMatchingAsk(scenario.userText, scenario.snapshot?.tasks ?? [])) return "I’ve passed your answer to the arm and it’s picking the work back up.";
  if (/\b(research|look into|find|write|draft|summar|check|monitor|watch|decide|choose)\b/.test(text)) return "I’ve handed that to the right specialist. I’ll bring you the result when it’s ready.";
  return "I’ve refreshed the stage with a concise brief of the current work.";
}

function modelResult(content: ScriptContent[], hasTools: boolean, callNumber: number) {
  const inputTotal = 180 + callNumber * 37;
  const outputTotal = hasTools ? 28 : 34;
  return {
    content,
    warnings: [],
    finishReason: { unified: hasTools ? "tool-calls" as const : "stop" as const, raw: hasTools ? "tool_calls" : "stop" },
    usage: {
      inputTokens: { total: inputTotal, noCache: inputTotal, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
    },
  };
}

export function createDemoModel(scenario: DemoScenario) {
  let callNumber = 0;
  const delay = Number(process.env.MC_DEMO_DELAY_MS ?? 900);
  return new MockLanguageModelV3({
    provider: "mission-control",
    modelId: "scripted-demo",
    doGenerate: async () => {
      if (Number.isFinite(delay) && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const index = callNumber++;
      const calls = scenario.kind === "shepherd"
        ? index === 0 ? shepherdCalls(scenario) : []
        : armCalls(scenario).slice(index, index + 1);
      if (calls.length) {
        return modelResult(calls.map((call, toolCallId) => ({
          type: "tool-call",
          toolCallId: `demo-${index}-${toolCallId}`,
          toolName: call.toolName,
          input: JSON.stringify(call.input),
        })), true, index);
      }
      const text = outputText(scenario);
      return modelResult([{ type: "text", text }], false, index);
    },
  });
}
