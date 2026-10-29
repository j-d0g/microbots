"use client";

import { createParser, type EventSourceMessage } from "eventsource-parser";
import { useAgentStore, type WindowKind } from "./store";
import { buildSnapshot } from "./agent/snapshot";
import { addChat } from "./api/backend";
import { canvasActionForEvent } from "./agent/canvas-reducer";

/* IDs of chat messages already persisted so retries (eg. duplicate
 * `reply.done` events from an upstream proxy) don't write twice. */
const persistedChatIds = new Set<string>();

/** Push the most recent user→agent exchange to `/api/kg/chats`.
 *  Fire-and-forget — failures land in the console but never block UI.
 *  Each turn is written as two rows (user + agent) so signal and
 *  output can be queried independently. */
async function persistChatTurn(userId: string | null): Promise<void> {
  const msgs = useAgentStore.getState().chatMessages;
  // Walk backwards to find the latest agent reply and the user turn
  // that triggered it.
  let agent: import("./store").ChatMessage | null = null;
  let user: import("./store").ChatMessage | null = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!agent && m.role === "agent") agent = m;
    else if (agent && !user && m.role === "user") {
      user = m;
      break;
    }
  }
  const writes: Promise<unknown>[] = [];
  if (user && !persistedChatIds.has(user.id) && user.text.trim()) {
    persistedChatIds.add(user.id);
    writes.push(
      addChat(
        {
          content: user.text,
          source_type: "ui_chat",
          source_id: user.id,
          signal_level: "high",
        },
        userId,
      ),
    );
  }
  if (agent && !persistedChatIds.has(agent.id) && agent.text.trim()) {
    persistedChatIds.add(agent.id);
    writes.push(
      addChat(
        {
          content: agent.text,
          source_type: "ui_chat",
          source_id: agent.id,
          signal_level: "mid",
        },
        userId,
      ),
    );
  }
  // We deliberately don't await — caller is fire-and-forget. Surface
  // errors to console for the dev tools but never throw.
  for (const w of writes) {
    w.catch((err) => {
      console.warn("[chat-persist] failed:", err);
    });
  }
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
  | { type: "reply.done" }
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
        s.finalizeLastAgentMessage();
      }
      // Fire-and-forget chat persistence. We push the most recent
      // user→agent pair as two separate `Chat` rows so the KG can
      // index user signal and agent output independently. The
      // `source_id` makes the call idempotent on retry.
      void persistChatTurn(state.userId);
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
