import type { Agent, Artifact, BusEvent, ChatMessage, FeedEvent, Snapshot, Task } from "@/lib/types";

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((current, currentIndex) => currentIndex === index ? item : current);
}

export function reduce(snapshot: Snapshot, event: BusEvent): Snapshot {
  switch (event.type) {
    case "snapshot":
      return event.snapshot;
    case "agent":
      return { ...snapshot, agents: upsert<Agent>(snapshot.agents, event.agent) };
    case "task":
      return { ...snapshot, tasks: upsert<Task>(snapshot.tasks, event.task) };
    case "task_deleted":
      return { ...snapshot, tasks: snapshot.tasks.filter((task) => task.id !== event.id) };
    case "artifact":
      return { ...snapshot, artifacts: upsert<Artifact>(snapshot.artifacts, event.artifact) };
    case "feed":
      return { ...snapshot, feed: [...snapshot.feed, event.event].slice(-300) };
    case "message":
      return { ...snapshot, messages: [...snapshot.messages, event.message].slice(-100) };
    case "focus":
      return { ...snapshot, focus: event.focus };
    case "stage":
      return { ...snapshot, stage: event.stage };
    case "speak":
    case "thinking":
      return snapshot;
  }
}

export type { Agent, Artifact, ChatMessage, FeedEvent, Task };
