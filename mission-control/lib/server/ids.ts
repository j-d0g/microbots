import { randomUUID } from "node:crypto";

export function shortId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}
