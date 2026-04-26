#!/usr/bin/env node
//
// Smoke test for the windowed-mode kind gate + user_id awareness.
//
// We mirror just enough of `applyToolToSnapshot` (server-snapshot.ts)
// in plain JS to assert:
//
//   1. `open_window` with kind ∉ {graph, settings, integration} is
//      REFUSED in windowed mode and recorded as ok=false.
//   2. The same kind is ACCEPTED in chat mode.
//   3. Two `open_window` calls with kind=integration but different
//      slugs produce TWO windows (slug-keyed dedupe).
//   4. Same kind+slug brings the existing window forward (no dup).
//
// The full tool surface lives in TS; if this contract drifts there,
// update the JS mirror here too. tsc + the unit tests cover the rest.

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`✗ ${label}`);
  }
}

let _id = 0;
const nextId = () => `win-${++_id}`;
const ALLOWED_WINDOWED = new Set(["graph", "settings", "integration"]);

function applyOpenWindow(snap, args) {
  const { kind, mount = "full", slug } = args;
  if (
    snap.ui?.mode === "windowed" &&
    !ALLOWED_WINDOWED.has(kind)
  ) {
    return {
      ...snap,
      lastResult: {
        ok: false,
        message: `windowed mode refuses kind ${kind}`,
      },
    };
  }
  // dedupe by (kind, slug) for integration; by kind for everything else
  const existing = snap.windows.find((w) => {
    if (w.kind !== kind) return false;
    if (kind === "integration") return (w.slug ?? null) === (slug ?? null);
    return true;
  });
  if (existing) {
    return {
      ...snap,
      lastResult: { ok: true, message: "brought to front", reused: true },
    };
  }
  return {
    ...snap,
    windows: [...snap.windows, { id: nextId(), kind, mount, slug }],
    lastResult: { ok: true, message: "opened" },
  };
}

const baseWindowed = { ui: { mode: "windowed" }, windows: [] };
const baseChat = { ui: { mode: "chat" }, windows: [] };

// 1. Refuse non-allowed kind in windowed mode
{
  const next = applyOpenWindow(baseWindowed, { kind: "brief" });
  ok("windowed refuses brief", next.lastResult.ok === false);
  ok("windowed refusal leaves windows empty", next.windows.length === 0);
}

// 2. Same kind allowed in chat mode
{
  const next = applyOpenWindow(baseChat, { kind: "brief" });
  ok("chat allows brief", next.lastResult.ok === true);
  ok("chat opens window", next.windows.length === 1);
}

// 3. integration with different slugs → two windows
{
  let s = baseWindowed;
  s = applyOpenWindow(s, { kind: "integration", slug: "slack" });
  s = applyOpenWindow(s, { kind: "integration", slug: "github" });
  ok(
    "two integration windows coexist (slug-keyed)",
    s.windows.length === 2 &&
      s.windows[0].slug === "slack" &&
      s.windows[1].slug === "github",
  );
}

// 4. Same kind+slug → reuse, no dup
{
  let s = baseWindowed;
  s = applyOpenWindow(s, { kind: "integration", slug: "slack" });
  s = applyOpenWindow(s, { kind: "integration", slug: "slack" });
  ok(
    "duplicate integration kind+slug brought to front",
    s.windows.length === 1 && s.lastResult.reused === true,
  );
}

// 5. graph + settings allowed in windowed mode
{
  let s = baseWindowed;
  s = applyOpenWindow(s, { kind: "graph" });
  s = applyOpenWindow(s, { kind: "settings" });
  ok(
    "graph + settings allowed in windowed",
    s.windows.length === 2 &&
      s.windows[0].kind === "graph" &&
      s.windows[1].kind === "settings",
  );
}

console.log(`${pass}/${pass + fail} windowed-mode-tools cases passed`);
if (fail > 0) process.exit(1);
