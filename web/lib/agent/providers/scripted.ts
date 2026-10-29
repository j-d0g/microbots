import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { matchLocalIntent } from "@/lib/agent-router";

type ScriptedToolCall = { name: string; input: Record<string, unknown> };
type ToolResult = { name: string; output: unknown };

const PR_REVIEW_OPTIONS = [
  "Draft review suggestions",
  "Ask before each review",
  "Keep reviews manual",
] as const;

const PR_REVIEW_REPLIES: Record<(typeof PR_REVIEW_OPTIONS)[number], string> = {
  "Draft review suggestions":
    "I’ll draft review suggestions. Nothing has been automated yet in this demo.",
  "Ask before each review":
    "I’ll ask before each review. Nothing has been automated yet in this demo.",
  "Keep reviews manual":
    "I’ll keep reviews manual. Nothing has been automated yet in this demo.",
};

function lastUserText(prompt: LanguageModelV3Prompt): string {
  const user = [...prompt].reverse().find((message) => message.role === "user");
  const text = user?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n") ?? "";
  const queryStart = text.lastIndexOf("user said:");
  return queryStart < 0 ? text : text.slice(queryStart + "user said:".length).trim();
}

function toolResults(prompt: LanguageModelV3Prompt): ToolResult[] {
  const results: ToolResult[] = [];
  for (const message of prompt as unknown as Array<{
    role?: string;
    content?: Array<Record<string, unknown>>;
  }>) {
    if (message.role !== "tool") continue;
    for (const part of message.content ?? []) {
      if (part.type !== "tool-result" || typeof part.toolName !== "string") continue;
      let output = part.output ?? part.result;
      if (
        output &&
        typeof output === "object" &&
        "type" in output &&
        output.type === "json" &&
        "value" in output
      ) {
        output = output.value;
      }
      results.push({ name: part.toolName, output });
    }
  }
  return results;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function latestResult(results: ToolResult[], name: string): Record<string, unknown> | null {
  const match = [...results].reverse().find((result) => result.name === name);
  return match ? asRecord(match.output) : null;
}

function searchResponse(
  query: string,
  results: ToolResult[],
  morningBrief: boolean,
): { toolCalls: ScriptedToolCall[]; text: string } | null {
  const output = latestResult(results, "search");
  if (!output) return null;
  const response = asRecord(output.result);
  const hits = Array.isArray(response?.results)
    ? response.results.map(asRecord).filter((hit): hit is Record<string, unknown> => hit !== null)
    : [];

  if (output.ok !== true) {
    return { toolCalls: [], text: "I couldn't search your graph just now." };
  }
  if (hits.length === 0) {
    return {
      toolCalls: [],
      text: `I couldn't find anything about ${query} in your graph. Try asking about deploys or people.`,
    };
  }

  if (morningBrief && !results.some((result) => result.name === "show")) {
    return {
      toolCalls: [{ name: "show", input: { kind: "workflows", focus: "Bug Triage" } }],
      text: "",
    };
  }

  const asksForIntegrationConnections =
    /\b(?:what(?:'s| is) connected to|connections to|show me the connections for)\b/i.test(query);
  const top = asksForIntegrationConnections
    ? hits.find((hit) => hit.kind === "integrations") ?? hits[0]
    : hits[0];
  const topKind = top.kind;
  if (topKind === "integrations") {
    const neighbors = Array.isArray(top.connections)
      ? top.connections
          .map(asRecord)
          .filter((connection): connection is Record<string, unknown> => connection !== null)
          .map((connection) => connection.name ?? connection.slug)
          .filter((name): name is string => typeof name === "string" && name.length > 0)
      : [];
    const name = typeof top.name === "string" ? top.name : "This integration";
    const neighborText = neighbors.length < 2
      ? neighbors.join("")
      : `${neighbors.slice(0, -1).join(", ")} and ${neighbors.at(-1)}`;
    const text = neighbors.length
      ? `${name} is connected in the knowledge graph to ${neighborText}.`
      : `The graph has no connections listed for ${name} yet.`;
    return { toolCalls: [], text: morningBrief ? `${text} Bug Triage is ready for a closer look.` : text };
  }

  const description = typeof top.snippet === "string" ? top.snippet : "";
  const name = typeof top.name === "string" ? `${top.name}: ` : "";
  const firstSentence = description.split(/(?<=[.!?])\s/, 1)[0];
  const resultText = description
    ? topKind === "entities"
      ? `${name}${firstSentence}`
      : `I found ${name}${firstSentence}`
    : "I found a matching item in your graph.";
  return {
    toolCalls: [],
    text: morningBrief
      ? `${resultText} Bug Triage is ready for a closer look.`
      : resultText,
  };
}

export function scriptedResponse(
  query: string,
  previousResults: ToolResult[] = [],
): { toolCalls: ScriptedToolCall[]; text: string } {
  const normalized = query.trim().toLowerCase();
  const morningBrief = /\bmorning brief\b|\bbrief\b/.test(normalized);

  const closeResult = latestResult(previousResults, "close");
  if (closeResult) {
    return {
      toolCalls: [],
      text: closeResult.ok === true ? "Closed the open card." : "Nothing's open.",
    };
  }

  const askResult = latestResult(previousResults, "ask_user");
  if (askResult) {
    return {
      toolCalls: [],
      text: "I can help make the repetitive parts of PR reviews easier; nothing has been automated yet.",
    };
  }

  const reviewAnswer = PR_REVIEW_OPTIONS.find(
    (option) => option.toLowerCase() === normalized,
  );
  if (reviewAnswer) {
    return { toolCalls: [], text: PR_REVIEW_REPLIES[reviewAnswer] };
  }

  const priorSearch = searchResponse(query, previousResults, morningBrief);
  if (priorSearch) return priorSearch;

  const priorShow = latestResult(previousResults, "show");
  if (priorShow) {
    if (
      priorShow.kind === "graph" &&
      Array.isArray(priorShow.neighbors)
    ) {
      const names = priorShow.neighbors.filter(
        (name): name is string => typeof name === "string",
      );
      const focus = typeof priorShow.focus === "string" ? priorShow.focus : "That integration";
      const visible = names.slice(0, 3);
      const more = names.length - visible.length;
      const list = visible.length > 1
        ? more > 0
          ? visible.join(", ")
          : `${visible.slice(0, -1).join(", ")} and ${visible.at(-1)}`
        : visible[0] ?? "no connected items";
      return {
        toolCalls: [],
        text: `${focus[0].toUpperCase()}${focus.slice(1)} connects to ${list}${more > 0 ? ` and ${more} more` : ""}.`,
      };
    }
    const kind = typeof priorShow.kind === "string" ? priorShow.kind : "card";
    return { toolCalls: [], text: `Here's the ${kind} card.` };
  }

  if (
    /^(?:help|what can you do\??|what do you do\??|what are your capabilities\??|how can you help\??)$/i
      .test(query.trim())
  ) {
    return {
      toolCalls: [],
      text: "I can search your graph, show focused cards, remember facts, and help shape workflows. Try “morning brief”, “what’s connected to Linear?”, “who is Bob?”, or “tell me about deploys”.",
    };
  }

  if (/^(?:close|clear|reset|close everything|clear (?:the )?(?:canvas|screen))$/i.test(normalized)) {
    return { toolCalls: [{ name: "close", input: {} }], text: "" };
  }

  if (/\bshould i automate pr reviews?\b|\bautomate pr reviews?\b/.test(normalized)) {
    return {
      toolCalls: [{
        name: "ask_user",
        input: {
          question: "How should I help with PR reviews?",
          options: PR_REVIEW_OPTIONS,
        },
      }],
      text: "",
    };
  }

  const focusMatch = normalized.match(/\bfocus(?: on)?\s+(.+?)\??$/);
  if (focusMatch) {
    const focus = focusMatch[1].trim();
    return {
      toolCalls: [{
        name: "show",
        input: { kind: "graph", focus },
      }],
      text: "",
    };
  }

  const workflowMatch = normalized.match(
    /^(?:show(?: me)?|open|tell me about)\s+(?:the\s+)?(.+?)\s+workflow\??$/,
  );
  const workflowFocus = workflowMatch?.[1] ?? (
    normalized === "bug triage" ? "bug triage" : null
  );
  if (workflowFocus) {
    const knownNames: Record<string, string> = {
      "bug triage": "Bug Triage",
      "deploy pipeline": "Deploy Pipeline",
      "pr review cycle": "PR Review Cycle",
    };
    return {
      toolCalls: [{
        name: "show",
        input: {
          kind: "workflows",
          focus: knownNames[workflowFocus] ?? workflowFocus,
        },
      }],
      text: "",
    };
  }

  if (morningBrief) {
    return {
      toolCalls: [{ name: "search", input: { query: "production deploy", scope: "all" } }],
      text: "",
    };
  }

  const integrationMatch = normalized.match(
    /\b(?:what(?:'s| is) connected to|connections to|show me the connections for)\s+(linear|github|notion|perplexity|slack|gmail)\b/,
  );
  if (integrationMatch) {
    return {
      toolCalls: [{
        name: "show",
        input: { kind: "graph", focus: integrationMatch[1] },
      }],
      text: "",
    };
  }

  if (/\b(?:tell me about|what do you know about|who is|who's|explain)\b/.test(normalized)) {
    const searchTermMatch = normalized.match(
      /^(?:who is|who's|tell me about|what do you know about|explain)\s+(.+?)[?!.]*$/,
    );
    const searchTerm = searchTermMatch?.[1].replace(/\bdeploys\b/g, "deploy");
    return {
      toolCalls: [{
        name: "search",
        input: { query: searchTerm ?? query, scope: "all" },
      }],
      text: "",
    };
  }

  const isDirectCardRequest =
    /^(?:(?:please\s+)?(?:show|open|view|display|list|draw)|focus(?:\s+on)?)\b/.test(normalized) ||
    normalized.trim().split(/\s+/).length <= 2;
  const kinds = isDirectCardRequest ? matchLocalIntent(query) : [];
  if (kinds.length > 0) {
    return {
      toolCalls: [{
        name: "show",
        input: { kind: kinds[0] },
      }],
      text: "",
    };
  }

  return {
    toolCalls: [{ name: "search", input: { query, scope: "all" } }],
    text: "",
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
      const { toolCalls, text } = scriptedResponse(
        lastUserText(prompt),
        toolResults(prompt),
      );
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
