/**
 * D — Backend-down failure surface harness.
 *
 * Goal: with the FastAPI backend (BASE_URL=https://app-bf31.onrender.com)
 * unreachable, walk the UI flows that depend on /api/kg/*, /api/composio/*
 * and /api/health and capture every visible failure mode.
 *
 * Strategy:
 *   - Don't actually stop the deployed Render instance — instead use
 *     page.route() to abort any request to the backend host. This
 *     reproduces "FastAPI not running" exactly as the browser sees it.
 *   - Capture all network events (request/response/requestfailed) so we
 *     can produce the canonical /api/kg/* + /api/composio/* call map.
 *   - Drive the UI through onboarding → settings → graph → integration →
 *     command-bar query, screenshotting at each broken state.
 *
 * Run from `web/`:
 *   node tests/parallel-runs-2026-04-26/D-backend-failure-surface/run.mjs
 */

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(
  "tests/parallel-runs-2026-04-26/D-backend-failure-surface",
);
const SHOTS = path.join(ROOT, "screenshots");
const APP_URL = "http://localhost:3001";
const BACKEND_HOSTS = [
  "app-bf31.onrender.com", // configured NEXT_PUBLIC_MICROBOTS_BASE_URL
  "localhost:8000", // local FastAPI / SurrealDB fallback (also "down")
];

/* ---------------- network log helpers ---------------- */

const networkLog = [];
const consoleEvents = [];

function classify(url) {
  if (/\/api\/kg\//.test(url)) return "kg";
  if (/\/api\/composio\//.test(url)) return "composio";
  if (/\/api\/health\b/.test(url) || /\/health\b/.test(url)) return "health";
  if (/\/api\/agent\//.test(url)) return "agent";
  return "other";
}

function isBackendCall(url) {
  return BACKEND_HOSTS.some((h) => url.includes(h));
}

function logEvent(entry) {
  networkLog.push({ t: Date.now(), ...entry });
}

/* ---------------- helpers ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function dumpJSON(name, data) {
  await fs.writeFile(
    path.join(ROOT, name),
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

/* ---------------- main ---------------- */

(async () => {
  await fs.mkdir(SHOTS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  /* abort every request to the backend host so we simulate "backend
   * not running" — the browser surfaces this as a network error
   * (requestfailed) which is exactly what backend.ts catches as
   * `BackendError("network error", 0)`. */
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (isBackendCall(url)) {
      await route.abort("connectionrefused");
      return;
    }
    await route.continue();
  });

  page.on("request", (req) => {
    const url = req.url();
    if (!isBackendCall(url) && classify(url) === "other") return;
    logEvent({
      phase: "request",
      url,
      method: req.method(),
      kind: classify(url),
    });
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (!isBackendCall(url) && classify(url) === "other") return;
    let snippet = null;
    try {
      const buf = await res.body();
      snippet = buf.toString("utf8").slice(0, 200);
    } catch {
      /* response was aborted before body could be read */
    }
    logEvent({
      phase: "response",
      url,
      status: res.status(),
      kind: classify(url),
      snippet,
    });
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!isBackendCall(url) && classify(url) === "other") return;
    logEvent({
      phase: "requestfailed",
      url,
      method: req.method(),
      kind: classify(url),
      errorText: req.failure()?.errorText ?? null,
    });
  });
  page.on("console", (msg) => {
    if (msg.type() === "log" || msg.type() === "info" || msg.type() === "debug")
      return;
    consoleEvents.push({
      t: Date.now(),
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    });
  });
  page.on("pageerror", (err) => {
    consoleEvents.push({
      t: Date.now(),
      type: "pageerror",
      text: err.message,
      stack: err.stack,
    });
  });

  const phases = [];
  const note = (label, data = {}) => {
    phases.push({ label, t: Date.now(), ...data });
    console.log(`[D] ${label}`, JSON.stringify(data));
  };

  /* ============ phase 1: load + onboard ============ */
  note("phase1-goto");
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await sleep(1500); // let StoreBridge fire warmUp + first /health probe
  await shot(page, "01-onboarding");

  // skip onboarding → opens settings centered
  await page.click('[data-testid="skip-onboarding"]', { timeout: 5_000 });
  await sleep(1500);
  await shot(page, "02-after-onboarding-settings-open");
  note("phase1-onboarded");

  /* ============ phase 2: settings + user_id + health ============ */
  // type user_id
  const userInput = page.locator('[data-testid="settings-user-id-input"]');
  await userInput.waitFor({ timeout: 5_000 });
  await userInput.click();
  await userInput.fill("test_e2e_d");
  await page.click('[data-testid="settings-user-id-save"]');
  await sleep(1000);
  await shot(page, "03-userid-saved");
  note("phase2-userid-saved");

  // probe the health badges before refresh
  const healthBeforeRefresh = await page.evaluate(() => {
    const surr = document.querySelector('[data-testid="settings-health-surrealdb"]');
    const comp = document.querySelector('[data-testid="settings-health-composio"]');
    return {
      surrealText: surr?.textContent?.trim() ?? null,
      composioText: comp?.textContent?.trim() ?? null,
      backendHealth:
        /** @type {any} */ (window).__store?.getState()?.backendHealth ?? null,
    };
  });
  note("phase2-health-pre-refresh", healthBeforeRefresh);

  // click manual refresh
  await page.click('[data-testid="settings-health-refresh"]');
  await sleep(2500); // wait for the failed request to complete + state to update
  await shot(page, "04-health-after-refresh");
  const healthAfterRefresh = await page.evaluate(() => {
    const surr = document.querySelector('[data-testid="settings-health-surrealdb"]');
    const comp = document.querySelector('[data-testid="settings-health-composio"]');
    return {
      surrealText: surr?.textContent?.trim() ?? null,
      composioText: comp?.textContent?.trim() ?? null,
      backendHealth:
        /** @type {any} */ (window).__store?.getState()?.backendHealth ?? null,
    };
  });
  note("phase2-health-post-refresh", healthAfterRefresh);

  /* ============ phase 3: open Graph room ============ */
  // Use the store directly — windowed mode has no dock buttons for room
  // navigation; the agent or store API drives it.
  await page.evaluate(() => {
    /** @type {any} */ (window).__store.getState().openWindow("graph");
  });
  await sleep(2500); // let all 7 fetches fail
  await shot(page, "05-graph-room");

  const graphSnap = await page.evaluate(() => {
    const noUser = document.querySelector('[data-testid="graph-no-user"]');
    const canvas = document.querySelector('[data-testid="graph-canvas"]');
    // Walk the canvas DOM for any visible state strings.
    const strings = canvas
      ? Array.from(canvas.querySelectorAll("p, button, div"))
          .map((el) => el.textContent?.trim())
          .filter((t) => t && t.length > 0 && t.length < 200)
      : [];
    return {
      noUserVisible: !!noUser,
      visibleText: Array.from(new Set(strings)).slice(0, 20),
    };
  });
  note("phase3-graph-state", graphSnap);

  /* ============ phase 4: open Brief room (chat mode) ============ *
   * In windowed mode brief is "refused" by design — the orchestrator
   * won't open it. We can switch to chat mode, where brief is the
   * default room, to confirm BriefRoom is purely seed-data based and
   * therefore renders fine even with backend down. */
  await page.evaluate(() => {
    /** @type {any} */ (window).__store.getState().setUiMode("chat");
    /** @type {any} */ (window).__store.getState().setChatRoom("brief");
  });
  await sleep(800);
  await shot(page, "06-brief-room-chat-mode");

  const briefSnap = await page.evaluate(() => {
    // Brief reads from seed; just sanity check that proposals render.
    const cards = Array.from(document.querySelectorAll('[data-testid^="brief-card-"]'));
    const yesterday = document.querySelector('[data-testid="brief-yesterday"]');
    return {
      cardCount: cards.length,
      hasYesterday: !!yesterday,
    };
  });
  note("phase4-brief-state", briefSnap);

  // back to windowed
  await page.evaluate(() => {
    /** @type {any} */ (window).__store.getState().setUiMode("windowed");
  });
  await sleep(500);

  /* ============ phase 5: open Slack integration room ============ */
  await page.evaluate(() => {
    /** @type {any} */ (window).__store
      .getState()
      .openWindow("integration", { payload: { slug: "slack" } });
  });
  await sleep(2000); // connections poll fails
  await shot(page, "07-integration-slack");

  const slackSnap = await page.evaluate(() => {
    const noUser = document.querySelector('[data-testid="integration-no-user"]');
    const initiated = document.querySelector('[data-testid="integration-slack-initiated"]');
    const connect = document.querySelector('[data-testid="integration-slack-connect"]');
    const visible = Array.from(document.querySelectorAll("article, section, p, button"))
      .map((el) => el.textContent?.trim())
      .filter((t) => t && t.length > 0 && t.length < 160);
    const store = /** @type {any} */ (window).__store?.getState();
    return {
      noUserVisible: !!noUser,
      initiatedVisible: !!initiated,
      connectButtonVisible: !!connect,
      connectButtonText: connect?.textContent?.trim() ?? null,
      connections: store?.connections ?? [],
      toolkits: store?.toolkits?.map((t) => t.slug) ?? [],
      visibleSampling: Array.from(new Set(visible)).slice(0, 30),
    };
  });
  note("phase5-slack-state", slackSnap);

  /* ============ phase 6: click the OAuth connect button ============ */
  // Toolkits never loaded → tkInfo is undefined → isApiKey is false →
  // OAuthConnectState renders. Click connect.
  if (slackSnap.connectButtonVisible) {
    await page.click('[data-testid="integration-slack-connect"]');
    await sleep(2500);
    await shot(page, "08-after-connect-click");
    const afterConnect = await page.evaluate(() => {
      const initiated = document.querySelector('[data-testid="integration-slack-initiated"]');
      const toasts = Array.from(
        document.querySelectorAll('[data-card-kind="toast"], [class*="toast" i]'),
      ).map((el) => el.textContent?.trim()).filter(Boolean);
      const visible = Array.from(document.querySelectorAll("section, p, div"))
        .map((el) => el.textContent?.trim())
        .filter((t) => t && t.length > 0 && t.length < 200);
      const store = /** @type {any} */ (window).__store?.getState();
      return {
        initiatedVisible: !!initiated,
        toasts,
        cards: store?.cards ?? [],
        url: window.location.href,
        visibleSampling: Array.from(new Set(visible)).slice(0, 30),
      };
    });
    note("phase6-after-connect-click", afterConnect);
  } else {
    note("phase6-no-connect-button", { reason: "button not rendered" });
  }

  /* ============ phase 7: command bar — "show me the graph" ============ */
  // press '/' to open command bar
  await page.keyboard.press("Slash");
  await sleep(400);
  await page.keyboard.type("show me the graph", { delay: 18 });
  await shot(page, "09-command-bar-typed");
  await page.keyboard.press("Enter");
  // wait for orchestrator stream to land + tool calls to fire
  await sleep(6500);
  await shot(page, "10-after-show-graph");

  const afterShowGraph = await page.evaluate(() => {
    const store = /** @type {any} */ (window).__store?.getState();
    const dock = document.querySelector('[data-testid="dock-text"]');
    return {
      dockText: dock?.textContent?.trim() ?? null,
      reply: store?.agentReply ?? null,
      lastQuery: store?.lastQuery ?? null,
      windows: (store?.windows ?? []).map((w) => ({
        kind: w.kind,
        payload: w.payload,
        minimized: w.minimized,
      })),
      backendHealth: store?.backendHealth ?? null,
    };
  });
  note("phase7-after-show-graph", afterShowGraph);

  /* ============ phase 8: wait for second health poll cycle ============ */
  // StoreBridge polls /api/health every 30s. The first poll fired during
  // phase1; we want to confirm subsequent polls keep failing silently.
  // Skip a long wait — instead, manually invoke refreshHealth via the
  // settings agent tool to confirm it's still down.
  note("phase8-second-refresh");
  await page.evaluate(() => {
    /** @type {any} */ (window).__store.getState().openWindow("settings");
  });
  await sleep(800);
  await page.click('[data-testid="settings-health-refresh"]');
  await sleep(2000);
  await shot(page, "11-second-refresh");

  /* ============ done ============ */

  // Summarize the inventory of backend calls.
  const inventory = networkLog
    .filter((e) => e.kind === "kg" || e.kind === "composio" || e.kind === "health")
    .map((e) => ({
      phase: e.phase,
      url: e.url.replace(/^https?:\/\/[^/]+/, ""),
      method: e.method ?? null,
      status: e.status ?? null,
      kind: e.kind,
      errorText: e.errorText ?? null,
    }));

  // Aggregate per-endpoint
  const byEndpoint = new Map();
  for (const e of inventory) {
    const key = `${e.method ?? "GET"} ${e.url.split("?")[0]}`;
    if (!byEndpoint.has(key)) {
      byEndpoint.set(key, {
        endpoint: key,
        kind: e.kind,
        attempts: 0,
        failures: 0,
        responses: 0,
        sampleError: null,
      });
    }
    const b = byEndpoint.get(key);
    if (e.phase === "request") b.attempts++;
    if (e.phase === "requestfailed") {
      b.failures++;
      if (!b.sampleError) b.sampleError = e.errorText;
    }
    if (e.phase === "response") b.responses++;
  }

  await dumpJSON("network-failures.json", {
    raw: networkLog,
    backendInventory: inventory,
    perEndpoint: Array.from(byEndpoint.values()),
  });
  await dumpJSON("console-errors.json", consoleEvents);
  await dumpJSON("phases.json", phases);

  await browser.close();

  console.log("\n=== summary ===");
  console.log("phases:", phases.length);
  console.log("network events:", networkLog.length);
  console.log("backend inventory rows:", inventory.length);
  console.log("per-endpoint rows:", byEndpoint.size);
  console.log("console events:", consoleEvents.length);
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
