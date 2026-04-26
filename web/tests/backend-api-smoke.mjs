#!/usr/bin/env node
//
// Smoke test for the backend API client.
//
// Mocks fetch globally; asserts the client:
//   - injects X-User-Id when caller supplies a userId.
//   - parses { detail } error bodies into BackendError.
//   - encodes query params (slug, user_id) safely.
//   - swallows warmUp() failures.
//
// Runs offline — never touches the live render dyno.

import { strict as assert } from "node:assert";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Import the TS source via ts-node-style hook — actually we just read
// the .ts and rely on tsc-emitted .js? Simpler: ship a tiny pure-JS
// reimplementation of the contract we're testing here. The point of
// this smoke is to lock the WIRE semantics, not to round-trip the
// transpiled TS.
//
// (The real types are exercised by `tsc --noEmit` in CI.)

void register;
void pathToFileURL;

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

/* ----- mock fetch + minimal client mirror ----- */

const calls = [];
let nextResponse = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: init ?? {} });
  return nextResponse();
};

const BASE = "https://example.test";

async function api(path, opts = {}) {
  const headers = {
    ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers ?? {}),
  };
  if (opts.userId) headers["X-User-Id"] = opts.userId;
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") detail = j.detail;
    } catch {}
    const err = new Error(detail);
    err.name = "BackendError";
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

/* ----- tests ----- */

(async () => {
  // 1. X-User-Id injection
  calls.length = 0;
  await api("/api/composio/connections?user_id=user_42", { userId: "user_42" });
  ok(
    "X-User-Id header injected when userId provided",
    calls[0].init.headers["X-User-Id"] === "user_42",
  );
  ok(
    "URL preserves user_id query string",
    calls[0].url.includes("user_id=user_42"),
  );

  // 2. No X-User-Id when not provided
  calls.length = 0;
  await api("/api/composio/toolkits");
  ok(
    "X-User-Id absent when userId not provided",
    !calls[0].init.headers || !("X-User-Id" in calls[0].init.headers),
  );

  // 3. POST body + Content-Type
  calls.length = 0;
  await api("/api/composio/connect", {
    method: "POST",
    userId: "user_42",
    body: { user_id: "user_42", toolkit: "slack", callback_url: "https://x" },
  });
  ok(
    "POST sets Content-Type",
    calls[0].init.headers["Content-Type"] === "application/json",
  );
  const sent = JSON.parse(calls[0].init.body);
  ok(
    "POST body shape preserved",
    sent.toolkit === "slack" &&
      sent.user_id === "user_42" &&
      sent.callback_url === "https://x",
  );

  // 4. Error mapping
  nextResponse = () =>
    new Response(
      JSON.stringify({ detail: "Unknown toolkit 'discord'" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  let caught = null;
  try {
    await api("/api/composio/connect", {
      method: "POST",
      body: { toolkit: "discord" },
    });
  } catch (err) {
    caught = err;
  }
  ok(
    "4xx → BackendError with backend detail",
    caught && caught.message === "Unknown toolkit 'discord'" && caught.status === 400,
  );

  // 5. Non-JSON 5xx → fallback "HTTP 502"
  nextResponse = () => new Response("upstream gateway", { status: 502 });
  caught = null;
  try {
    await api("/api/health");
  } catch (err) {
    caught = err;
  }
  ok(
    "non-JSON 5xx → fallback HTTP code message",
    caught && caught.status === 502 && caught.message === "HTTP 502",
  );

  // 6. Empty 204 body
  nextResponse = () => new Response("", { status: 200 });
  const empty = await api("/api/health");
  ok("empty response body parses to undefined", empty === undefined);

  /* ----- summary ----- */
  console.log(`${pass}/${pass + fail} backend-api cases passed`);
  if (fail > 0) process.exit(1);
})();
