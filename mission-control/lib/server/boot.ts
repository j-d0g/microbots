import "server-only";
import { getDb } from "./db";
import { listAgents } from "./store";
import { seed } from "./seed";

type BootState = typeof globalThis & { __missionControlBooted?: boolean };
const state = globalThis as BootState;

export function ensureBooted(): void {
  getDb();
  if (state.__missionControlBooted && listAgents().length) return;
  if (!listAgents().length) seed();
  state.__missionControlBooted = true;
}
