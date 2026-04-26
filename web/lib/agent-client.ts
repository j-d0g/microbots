"use client";

import { createParser, type EventSourceMessage } from "eventsource-parser";
import { useAgentStore, type RoomKind, type VerbPayload } from "./store";
import { callRoomTool } from "./room-tools";
import { buildSnapshot } from "./agent/snapshot";

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
  | {
      type: "ui.resize";
      room?: RoomKind;
      rect: { x?: number; y?: number; w?: number; h?: number };
    }
  | {
      type: "ui.tool";
      room: RoomKind;
      tool: string;
      args?: Record<string, unknown>;
    }
  | { type: "speak.chunk"; text: string }
  | { type: "agent.status"; status: string }
  | { type: "dock"; state: "idle" | "listening" | "thinking" | "speaking" | "hidden" }
  | { type: "reply.start"; query: string }
  | { type: "reply.chunk"; text: string }
  | { type: "reply.done" }
  /** Orchestrator handed off to a sub-agent. The sidecar renders a chip. */
  | { type: "agent.delegate"; to: "layout" | "content"; intent: string }
  /** A sub-agent issued a tool. The sidecar pushes a live row. */
  | { type: "agent.tool.start"; name: string; args: Record<string, unknown> }
  /** A sub-agent's tool returned. The sidecar marks the row done. */
  | { type: "agent.tool.done"; name: string; ok: boolean };

export function applyAgentEvent(evt: AgentEvent): void {
  const s = useAgentStore.getState();
  const chat = s.uiMode === "chat";
  switch (evt.type) {
    case "ui.room":
      if (chat) {
        // Single-room mode: just swap the focused room.
        s.setChatRoom(evt.room);
      } else {
        s.openWindow(evt.room, { rect: evt.rect, payload: evt.payload });
      }
      if (evt.slug) s.setRoomSlug(evt.slug);
      else s.setRoomSlug(null);
      break;
    case "ui.arrange":
      // Layout presets are windowed-only.
      if (!chat) s.arrangeWindows(evt.layout);
      break;
    case "ui.close_window": {
      // No close in chat mode — there's always a room shown.
      if (chat) break;
      if (evt.room) {
        const target = s.windows.find((w) => w.kind === evt.room);
        if (target) s.closeWindow(target.id);
      } else {
        s.closeTopWindow();
      }
      break;
    }
    case "ui.resize": {
      // Resize is windowed-only.
      if (chat) break;
      const target = evt.room
        ? s.windows.find((w) => w.kind === evt.room && !w.minimized)
        : [...s.windows].filter((w) => !w.minimized).sort((a, b) => b.zIndex - a.zIndex)[0];
      if (target) s.updateWindowRect(target.id, evt.rect);
      break;
    }
    case "ui.tool": {
      // In-window tools work in BOTH modes.
      // Fire-and-forget; agents don't await tool side-effects in the event stream.
      void callRoomTool(evt.room, evt.tool, evt.args ?? {});
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
      // In chat mode, push a fresh agent message placeholder. The user
      // message itself is pushed by the chat input handler at submit
      // time so we don't double-record it here.
      if (chat) {
        s.appendChatMessage({
          id: `agent-${Date.now()}`,
          role: "agent",
          text: "",
          ts: Date.now(),
          room: s.chatRoom,
          status: "streaming",
        });
      }
      break;
    case "reply.chunk":
      s.appendReply(evt.text);
      if (chat) s.appendToLastAgentMessage(evt.text);
      break;
    case "reply.done":
      if (chat) s.finalizeLastAgentMessage();
      break;
    case "agent.delegate":
      // Mirror into the recent-actions ring so the SnapshotInspector
      // reflects the delegation; sidecar UI will read this too.
      s.pushAction({
        t: Date.now(),
        tool: `delegate_${evt.to}`,
        args: { intent: evt.intent },
        ok: true,
      });
      break;
    case "agent.tool.start":
      s.pushAction({
        t: Date.now(),
        tool: evt.name,
        args: evt.args,
        ok: true,
      });
      break;
    case "agent.tool.done":
      // No store change — the start record above already marks it ok.
      // We could stamp the duration here once we capture start times.
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

/** Sentinel thrown when the orchestrate route signals it can't run
 *  (e.g. no API key). Callers should catch this and degrade to the
 *  scripted local fallback (`routeIntent` from `agent-router.ts`). */
export class AgentFallback extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "AgentFallback";
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

/** Send a user query to the orchestrator, posting a fresh canvas
 *  snapshot so the agent has eyes. Throws `AgentFallback` if the route
 *  is unreachable or returns 503 (no key). The CommandBar catches that
 *  and runs `routeIntent()` locally so the demo still works. */
export async function sendQuery(
  query: string,
  signal?: AbortSignal,
): Promise<void> {
  const snapshot = buildSnapshot({ query });
  let res: Response;
  try {
    res = await fetch("/api/agent/orchestrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, snapshot }),
      signal,
    });
  } catch (err) {
    throw new AgentFallback(
      err instanceof Error ? err.message : "network error",
    );
  }

  if (res.status === 503 || res.headers.get("x-agent-fallback") === "local") {
    throw new AgentFallback("no API key configured");
  }
  if (!res.ok || !res.body) {
    throw new AgentFallback(`orchestrate returned ${res.status}`);
  }

  await consumeSSE(res.body, signal);
}
