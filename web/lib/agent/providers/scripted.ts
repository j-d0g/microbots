import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV3Prompt, LanguageModelV3StreamPart } from "@ai-sdk/provider";

type ScriptedToolCall = { name: string; input: Record<string, unknown> };

const WINDOW_KINDS = [
  "profile",
  "integrations",
  "integration_detail",
  "entities",
  "entity_detail",
  "memories",
  "skills",
  "workflows",
  "wiki",
  "chats_summary",
  "chat",
  "graph",
  "ask_user",
  "settings",
  "composio_connect",
] as const;

function lastUserText(prompt: LanguageModelV3Prompt): string {
  const user = [...prompt].reverse().find((message) => message.role === "user");
  const text = user?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n") ?? "";
  const queryStart = text.lastIndexOf("user said:");
  return queryStart < 0 ? text : text.slice(queryStart + "user said:".length).trim();
}

export function scriptedResponse(query: string): {
  toolCalls: ScriptedToolCall[];
  text: string;
} {
  const normalized = query.toLowerCase();
  if (/\b(?:clear|reset)\b.*\b(?:graph\s+)?filters?\b/.test(normalized)) {
    return { toolCalls: [{ name: "graph_clear", input: {} }], text: "cleared the graph filters." };
  }
  if (/\bclose everything\b|\bclear\b/.test(normalized)) {
    return { toolCalls: [{ name: "clear_canvas", input: {} }], text: "cleared the canvas." };
  }
  if (/\bshould i automate pr reviews?\b|\bautomate pr reviews?\b/.test(normalized)) {
    return {
      toolCalls: [{
        name: "ask_user",
        input: {
          question: "How should I help with PR reviews?",
          options: ["Draft review suggestions", "Ask before each review", "Keep reviews manual"],
        },
      }],
      text: "I can help make the repetitive parts of PR reviews easier. Would you like me to draft suggestions, ask before each review, or leave the process manual?",
    };
  }
  if (/\bmorning brief\b|\bbrief\b/.test(normalized)) {
    return {
      toolCalls: [
        { name: "search_memory", input: { query: "#deployments" } },
        { name: "open_window", input: { kind: "memories" } },
        { name: "open_window", input: { kind: "workflows", focus: "Bug Triage" } },
      ],
      text: "Your notes mention Alice Chen, the #deployments convention, and creating Linear tickets before PRs. Your workflow list includes Bug Triage and PR Review Cycle, so either is ready for a closer look.",
    };
  }
  const integrationMatch = normalized.match(
    /\b(?:what(?:'s| is) connected to|connections to|show me the connections for)\s+(linear|github|notion|perplexity|slack|gmail)\b/,
  );
  if (integrationMatch) {
    const integration = integrationMatch[1];
    const integrations: Record<string, { name: string; neighbors: string[] }> = {
      linear: { name: "Linear", neighbors: ["Notion"] },
      github: { name: "GitHub", neighbors: ["Perplexity", "Linear"] },
      notion: { name: "Notion", neighbors: [] },
      perplexity: { name: "Perplexity", neighbors: ["Notion"] },
      slack: { name: "Slack", neighbors: ["Perplexity", "Linear", "GitHub", "Notion"] },
      gmail: { name: "Gmail", neighbors: [] },
    };
    const { name, neighbors } = integrations[integration];
    const neighborText = neighbors.length <= 2
      ? neighbors.join(" and ")
      : `${neighbors.slice(0, -1).join(", ")}, and ${neighbors[neighbors.length - 1]}`;
    return {
      toolCalls: [{ name: "open_window", input: { kind: "graph", focus: name } }],
      text: neighbors.length
        ? `${name} is connected in the knowledge graph to ${neighborText}.`
        : `The seeded graph has no connections listed for ${name} yet.`,
    };
  }
  const workflowMatch = normalized.match(
    /\b(?:(?:show me|open)(?:\s+the)?\s+)?(bug triage|deploy pipeline|pr review cycle)(?:\s+workflow)?\b/,
  );
  if (workflowMatch) {
    const names: Record<string, { name: string; summary: string }> = {
      "bug triage": {
        name: "Bug Triage",
        summary: "It starts with a Slack report, creates a Linear ticket, then moves through investigation, a fix, and deployment.",
      },
      "deploy pipeline": {
        name: "Deploy Pipeline",
        summary: "It moves from a Linear ticket through staging, smoke tests, production deployment, and Slack notifications.",
      },
      "pr review cycle": {
        name: "PR Review Cycle",
        summary: "It covers Linear ticket creation, opening a branch and PR, review by Bob, feedback, and merge.",
      },
    };
    const workflow = names[workflowMatch[1]];
    return {
      toolCalls: [{ name: "open_window", input: { kind: "workflows", focus: workflow.name } }],
      text: workflow.summary,
    };
  }
  const kindPattern = [...WINDOW_KINDS]
    .sort((a, b) => b.length - a.length)
    .map((kind) => kind.replaceAll("_", "[ _-]"))
    .join("|");
  const closeMatch = normalized.match(new RegExp(`\\bclose\\s+(${kindPattern})\\b`));
  if (closeMatch) {
    return {
      toolCalls: [{
        name: "close_window",
        input: { kind: normalizeKind(closeMatch[1]) },
      }],
      text: `Closed ${normalizeKind(closeMatch[1])}.`,
    };
  }
  const focusMatch = normalized.match(new RegExp(`\\bfocus\\s+(?:on\\s+)?(${kindPattern})\\b`));
  if (focusMatch) {
    return {
      toolCalls: [{
        name: "focus_window",
        input: { kind: normalizeKind(focusMatch[1]) },
      }],
      text: `Focused ${normalizeKind(focusMatch[1])}.`,
    };
  }
  if (/\bgraph\b/.test(normalized)) {
    return {
      toolCalls: [{ name: "open_window", input: { kind: "graph" } }],
      text: "here's your graph.",
    };
  }
  const showMatch = normalized.match(/\b(?:show|open)\s+(?:me\s+)?(?:the\s+)?(memories|memory|workflows?|skills|wiki|entities|entity|integrations?|settings|profile)\b/);
  const kind = showMatch ? normalizeKind(showMatch[1]) : undefined;
  if (kind && WINDOW_KINDS.includes(kind as typeof WINDOW_KINDS[number])) {
    return {
      toolCalls: [{ name: "open_window", input: { kind } }],
      text: `Opened ${kind}.`,
    };
  }
  return {
    toolCalls: [],
    text: "scripted mode — try: morning brief, what's connected to Linear, show me the Bug Triage workflow, should I automate PR reviews?",
  };
}

function usage() {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
}

export function scriptedModel() {
  return new MockLanguageModelV3({
    provider: "microbots",
    modelId: "scripted",
    doStream: async ({ prompt }) => {
      const { toolCalls, text } = scriptedResponse(lastUserText(prompt));
      const chunks: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        ...toolCalls.map((call, index) => ({
          type: "tool-call" as const,
          toolCallId: `scripted-${index}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        })),
        ...(text
          ? [
              { type: "text-start" as const, id: "scripted-reply" },
              ...(text.match(/\S+\s*/g) ?? [text]).map((delta) => ({
                type: "text-delta" as const,
                id: "scripted-reply",
                delta,
              })),
              { type: "text-end" as const, id: "scripted-reply" },
            ]
          : []),
        {
          type: "finish",
          finishReason: {
            unified: toolCalls.length > 0 ? "tool-calls" : "stop",
            raw: undefined,
          },
          usage: usage(),
        },
      ];
      return {
        stream: simulateReadableStream({
          chunks,
          initialDelayInMs: 500,
          chunkDelayInMs: 35,
        }),
      };
    },
  });
}

function normalizeKind(kind: string): string {
  kind = kind.replace(/[ -]/g, "_");
  if (kind === "integration") return "integrations";
  if (kind === "entity") return "entities";
  if (kind === "memory") return "memories";
  if (kind === "workflow") return "workflows";
  if (kind === "chat") return "chat";
  if (kind === "chats") return "chats_summary";
  return kind;
}
