"use client";

import { createParser, type EventSourceMessage } from "eventsource-parser";
import { useAgentStore, type RoomKind, type VerbPayload } from "./store";

export type AgentEvent =
  | {
      type: "ui.room";
      room: RoomKind;
      slug?: string;
      payload?: Record<string, unknown>;
      rect?: { x?: number; y?: number; w?: number; h?: number };
    }
  | { type: "ui.verb"; verb: VerbPayload["verb"]; args: Record<string, unknown> }
  | {
      type: "ui.card";
      card: {
        id: string;
        kind: "memory" | "entity" | "source" | "diff" | "toast";
        data: Record<string, unknown>;
        ttl?: number;
      };
    }
  | { type: "ui.arrange"; layout: "focus" | "split" | "grid" | "stack-right" }
  | { type: "ui.close_window"; room?: RoomKind }
  | { type: "speak.chunk"; text: string }
  | { type: "agent.status"; status: string }
  | { type: "dock"; state: "idle" | "listening" | "thinking" | "speaking" | "hidden" }
  | { type: "reply.start"; query: string }
  | { type: "reply.chunk"; text: string }
  | { type: "reply.done" };

export function applyAgentEvent(evt: AgentEvent): void {
  const s = useAgentStore.getState();
  switch (evt.type) {
    case "ui.room":
      s.openWindow(evt.room, { rect: evt.rect, payload: evt.payload });
      if (evt.slug) s.setRoomSlug(evt.slug);
      else s.setRoomSlug(null);
      break;
    case "ui.arrange":
      s.arrangeWindows(evt.layout);
      break;
    case "ui.close_window": {
      if (evt.room) {
        const target = s.windows.find((w) => w.kind === evt.room);
        if (target) s.closeWindow(target.id);
      } else {
        s.closeTopWindow();
      }
      break;
    }
    case "ui.verb":
      s.emitVerb({ verb: evt.verb, args: evt.args, at: Date.now() });
      break;
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
      s.startReply(evt.query);
      break;
    case "reply.chunk":
      s.appendReply(evt.text);
      break;
    case "reply.done":
      break;
  }
}

export async function connectAgentStream(
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/agent/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: useAgentStore.getState().room }),
    signal,
  });
  if (!res.body) return;
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
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
}

/** Send a user query to the agent and apply events as they stream back */
export async function sendQuery(
  query: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/agent/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, room: useAgentStore.getState().room }),
    signal,
  });
  if (!res.body) return;
  const decoder = new TextDecoder();
  const parser = createParser({
    onEvent: (msg: EventSourceMessage) => {
      if (!msg.data) return;
      try {
        const parsed = JSON.parse(msg.data) as AgentEvent;
        applyAgentEvent(parsed);
      } catch {
        // swallow
      }
    },
  });
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
}
