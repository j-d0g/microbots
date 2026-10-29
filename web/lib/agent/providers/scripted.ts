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
  if (/\bmorning brief\b|\bbrief\b/.test(normalized)) {
    return {
      toolCalls: [
        { name: "open_window", input: { kind: "memories" } },
        { name: "open_window", input: { kind: "workflows" } },
        { name: "arrange_windows", input: { layout: "split" } },
      ],
      text: "morning. here's your brief.",
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
    text: "scripted mode — try: show me the graph, morning brief, focus memories, close everything",
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
              { type: "text-delta" as const, id: "scripted-reply", delta: text },
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
      return { stream: simulateReadableStream({ chunks }) };
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
