import "server-only";
import { EventEmitter } from "node:events";
import type { BusEvent } from "@/lib/types";

type BusState = typeof globalThis & { __missionControlBus?: EventEmitter };
const state = globalThis as BusState;

function emitter(): EventEmitter {
  return (state.__missionControlBus ??= new EventEmitter());
}

export function publish(event: BusEvent): void {
  emitter().emit("event", event);
}

export function subscribe(fn: (event: BusEvent) => void): () => void {
  emitter().on("event", fn);
  return () => emitter().off("event", fn);
}
