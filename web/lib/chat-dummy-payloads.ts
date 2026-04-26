/**
 * Chat-mode payload seeding (vestigial).
 *
 * Historically every window kind had a hand-authored "dummy" payload
 * so chat mode never showed a blank pane. With the schema-driven
 * windows, each component fetches its own data from `/api/kg/*` via
 * `useKgResource`, so the empty / loading state is the new ground
 * truth — no fake data leaks through the UI any more.
 *
 * The export is kept so existing call sites keep compiling; it now
 * returns `undefined` for every kind. Delete the file once `EmbeddedRoom`
 * stops calling it.
 */
import type { WindowKind } from "./store";

export function getDummyPayload(
  _kind: WindowKind,
): Record<string, unknown> | undefined {
  return undefined;
}
