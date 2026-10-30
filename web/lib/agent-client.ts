"use client";

import { createParser, type EventSourceMessage } from "eventsource-parser";
import { useAgentStore, type WindowKind } from "./store";
import { buildSnapshot } from "./agent/snapshot";
import { canvasActionForEvent } from "./agent/canvas-reducer";

/** Token usage for one agent reply, summed over all steps. */
export interface ReplyUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AgentEvent =
  | {
      type: "ui.card";
      card: {
        id: string;
        kind: "memory" | "entity" | "source" | "diff" | "toast";
        data: Record<string, unknown>;
        ttl?: number;
      };
    }
  | { type: "ui.canvas"; action: import("./agent/canvas-reducer").CanvasAction }
  | {
      type: "ui.tool.open";
      kind: WindowKind;
      payload: Record<string, unknown>;
    }
  | {
      type: "ui.tool.update";
      kind: WindowKind;
      payload: Record<string, unknown>;
    }
  | {
      type: "ui.tool.done";
      kind: WindowKind;
      payload?: Record<string, unknown>;
    }
  | {
      type: "ui.ask";
      question: string;
      options: string[];
    }
  | { type: "speak.chunk"; text: string }
  | { type: "agent.status"; status: string }
  | { type: "dock"; state: "idle" | "listening" | "thinking" | "speaking" | "hidden" }
  | { type: "reply.start"; query: string }
  | { type: "reply.chunk"; text: string }
  | { type: "reply.done"; usage?: ReplyUsage }
  /** Orchestrator handed off to a sub-agent. The sidecar renders a chip. */
  | { type: "agent.delegate"; to: "layout" | "content"; intent: string }
  /** A tool was called. The sidecar pushes a live row. */
  | { type: "agent.tool.start"; name: string; args: Record<string, unknown> }
  /** A tool returned. The sidecar marks the row done. */
  | { type: "agent.tool.done"; name: string; ok: boolean }
  /** Bonus steps after a tool failure (recovery). */
  | { type: "agent.tool.retry"; bonus: number; effectiveCap: number };

export function applyAgentEvent(evt: AgentEvent): void {
  const s = useAgentStore.getState();
  const canvasAction = canvasActionForEvent(evt);
  if (canvasAction) {
    s.dispatchCanvas(canvasAction);
    if (canvasAction.type === "open") {
      s.attachChatCard(canvasAction.kind, canvasAction.payload);
    }
  }
  switch (evt.type) {
    case "ui.card":
      s.pushCard({
        id: evt.card.id,
        kind: evt.card.kind,
        data: evt.card.data,
        ttl: evt.card.ttl,
      });
      if (evt.card.ttl) {
        setTimeout(() => useAgentStore.getState().dismissCard(evt.card.id), evt.card.ttl);
      }
      break;
    case "speak.chunk":
      s.setAgentStatus(evt.text);
      break;
    case "agent.status":
      s.setAgentStatus(evt.status);
      break;
    case "dock":
      s.setDock(evt.state);
      break;
    case "reply.start":
      // Create the agent history slot lazily in reply.chunk so tool-only
      // turns don't leave empty bubbles.
      s.startReply(evt.query);
      if (evt.query.trim().length > 0) {
        const last = useAgentStore.getState().chatMessages.at(-1);
        // Skip the push if ChatPanel already pushed this exact query
        // a tick ago (its onSend appends synchronously before the SSE
        // turns it into a reply.start).
        const alreadyRecorded =
          last?.role === "user" && last.text === evt.query;
        if (!alreadyRecorded) {
          s.appendChatMessage({
            id: `user-${Date.now()}`,
            role: "user",
            text: evt.query,
            ts: Date.now(),
            room: s.chatRoom,
          });
        }
      }
      break;
    case "reply.chunk":
      s.appendReply(evt.text);
      s.appendToLastAgentMessage(evt.text);
      break;
    case "reply.done": {
      const state = useAgentStore.getState();
      const last = state.chatMessages.at(-1);
      if (last?.role === "agent" && last.status === "streaming") {
        s.finalizeLastAgentMessage("done", evt.usage);
      }
      break;
    }
    case "agent.tool.start":
      s.startChatToolTrace(evt.name, evt.args);
      break;
    case "agent.tool.done":
      s.finishChatToolTrace(evt.name, evt.ok);
      break;
    case "agent.tool.retry":
      // Sidecar / inspector can read this from the event stream.
      // No store mutation needed.
      break;
  }
}

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder();
  const parser = createParser({
    onEvent: (msg: EventSourceMessage) => {
      if (!msg.data) return;
      try {
        const parsed = JSON.parse(msg.data) as AgentEvent;
        applyAgentEvent(parsed);
      } catch {
        // swallow bad frames
      }
    },
  });
  const reader = body.getReader();
  while (true) {
    if (signal?.aborted) {
      reader.cancel().catch(() => undefined);
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
}

/** Send a user query to the server orchestrator with the current card context. */
export async function sendQuery(
  query: string,
  signal?: AbortSignal,
): Promise<void> {
  const snapshot = buildSnapshot();
  let res: Response;
  try {
    res = await fetch("/api/agent/orchestrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        snapshot,
        userId: useAgentStore.getState().userId ?? null,
      }),
      signal,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "network error");
  }

  if (!res.ok || !res.body) {
    throw new Error(`orchestrate returned ${res.status}`);
  }

  await consumeSSE(res.body, signal);
}
