import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

type DbState = typeof globalThis & { __missionControlDb?: Database.Database };
const state = globalThis as DbState;

export function getDb(): Database.Database {
  if (state.__missionControlDb) return state.__missionControlDb;

  const dataDir = resolve(process.cwd(), process.env.MC_DATA_DIR || ".data");
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(resolve(dataDir, "mission-control.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, data TEXT NOT NULL);
  `);
  state.__missionControlDb = db;
  return db;
}

export function clearDb(): void {
  const db = getDb();
  db.exec("DELETE FROM agents; DELETE FROM tasks; DELETE FROM artifacts; DELETE FROM events; DELETE FROM messages; DELETE FROM kv;");
}

export function closeDb(): void {
  state.__missionControlDb?.close();
  delete state.__missionControlDb;
}
