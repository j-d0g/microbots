"use client";

import { createParser, type EventSourceMessage } from "eventsource-parser";
import { useAgentStore, type WindowKind, type RoomKind, type VerbPayload, type ConfirmIntent } from "./store";
import { callRoomTool } from "./room-tools";
import { buildSnapshot } from "./agent/snapshot";
import { addChat } from "./kg-client";

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
  /* ── V1 tool-window events ── */
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
  | {
      type: "ui.confirm";
      intent: ConfirmIntent;
    }
  | {
      type: "ui.confirm.resolved";
      id: string;
      approved: boolean;
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
  const chat = s.uiMode === "chat";
  switch (evt.type) {
    case "ui.room":
      if (chat) {
        // Chat mode: swap the focused room AND ensure a window of
        // that kind exists so EmbeddedRoom renders with the agent's
        // payload (not the dummy fallback). Resize is intentionally
        // ignored — chat mode is single-focal, the right pane fills
        // the available space regardless.
        s.setChatRoom(evt.room);
        s.openWindow(evt.room, { payload: evt.payload });
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
    /* ── V1 tool-window events ── */
    case "ui.tool.open": {
      // Open the tool's window with payload (or update if already open).
      s.openWindow(evt.kind, { payload: evt.payload });
      // In chat mode the right pane shows whichever kind is the
      // active `chatRoom`; surface this newly-opened window there
      // so the user actually sees what the agent just pulled up.
      if (chat) s.setChatRoom(evt.kind);
      break;
    }
    case "ui.tool.update": {
      // Update an existing tool window's payload. Find and re-open.
      const target = s.windows.find((w) => w.kind === evt.kind);
      if (target) {
        s.openWindow(evt.kind, { payload: { ...target.payload, ...evt.payload } });
      }
      break;
    }
    case "ui.tool.done": {
      // Mark the tool window as done by merging status into payload.
      const target = s.windows.find((w) => w.kind === evt.kind);
      if (target) {
        s.openWindow(evt.kind, { payload: { ...target.payload, ...evt.payload, status: "done" } });
      }
      break;
    }
    case "ui.ask": {
      // Open ask_user as a modal window with the question + options.
      s.openWindow("ask_user", {
        payload: { question: evt.question, options: evt.options },
      });
      break;
    }
    case "ui.confirm": {
      // Stage a confirm gate.
      s.stageConfirm(evt.intent);
      break;
    }
    case "ui.confirm.resolved": {
      // Resolve a pending confirm gate.
      s.resolveConfirm(evt.id, evt.approved);
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
      // Clear any stale agentReply from the previous turn. The chat-
      // history slot for the AGENT is created lazily in reply.chunk
      // below so tools-only turns (no text) don't leave empty agent
      // bubbles. The USER message is recorded here so windowed-mode
      // input (CommandBar / VoiceBridge) lands in the transcript
      // identically to chat-mode input.
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
      {
        const last = useAgentStore.getState().chatMessages.at(-1);
        if (last?.role === "agent" && last.status === "streaming") {
          s.appendToLastAgentMessage(evt.text);
        } else {
          s.appendChatMessage({
            id: `agent-${Date.now()}`,
            role: "agent",
            text: evt.text,
            ts: Date.now(),
            room: s.chatRoom,
            status: "streaming",
          });
        }
      }
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
    case "agent.tool.retry":
      // Sidecar / inspector can read this from the event stream.
      // No store mutation needed.
      break;
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
