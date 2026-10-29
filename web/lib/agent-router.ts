"use client";

import type { AgentEvent } from "./agent-client";
import type { RoomKind } from "./store";

const INTENTS: ReadonlyArray<{
  keywords: readonly string[];
  rooms: readonly RoomKind[];
}> = [
  { keywords: ["graph", "map", "knowledge"], rooms: ["graph"] },
  { keywords: ["memor"], rooms: ["memories"] },
  {
    keywords: ["workflow", "playbook", "automation", "bug triage", "deploy", "pr review"],
    rooms: ["workflows"],
  },
  { keywords: ["skill"], rooms: ["skills"] },
  {
    keywords: ["integration", "connect", "stack", "slack", "github", "linear", "gmail", "notion"],
    rooms: ["integrations"],
  },
  {
    keywords: ["entit", "people", "contact", "team", "members"],
    rooms: ["entities"],
  },
  {
    keywords: ["brief", "today", "morning"],
    rooms: ["memories", "workflows"],
  },
];

const LOCAL_MODE_REPLY =
  "local mode — try: graph, memories, workflows, skills, or integrations";

export function matchLocalIntent(query: string): RoomKind[] {
  const normalized = query.toLowerCase();
  const rooms = new Set<RoomKind>();

  for (const intent of INTENTS) {
    if (intent.keywords.some((keyword) => normalized.includes(keyword))) {
      for (const room of intent.rooms) rooms.add(room);
    }
  }

  return [...rooms];
}

export async function* routeIntent(query: string): AsyncGenerator<AgentEvent> {
  const rooms = matchLocalIntent(query);
  const reply = rooms.length
    ? `opening ${rooms.map((room) => room.replace(/_/g, " ")).join(" and ")} (local mode)`
    : LOCAL_MODE_REPLY;

  yield { type: "dock", state: "thinking" };
  yield { type: "reply.start", query };
  for (const room of rooms) yield { type: "ui.room", room };
  yield { type: "reply.chunk", text: reply };
  yield { type: "reply.done" };
  yield { type: "dock", state: "idle" };
}
