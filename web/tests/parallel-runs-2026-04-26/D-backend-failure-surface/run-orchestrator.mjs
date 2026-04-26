/**
 * Supplemental: focused test of orchestrator reply when backend is down.
 *
 * Distinct from run.mjs because the integration-window focus stole the
 * "/" keystroke. Here we explicitly blur, click body, then re-type.
 */

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(
  "tests/parallel-runs-2026-04-26/D-backend-failure-surface",
);
const SHOTS = path.join(ROOT, "screenshots");
const APP_URL = "http://localhost:3001";
const BACKEND_HOSTS = ["app-bf31.onrender.com", "localhost:8000"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const orchEvents = [];

(async () => {
  await fs.mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (BACKEND_HOSTS.some((h) => url.includes(h))) {
      await route.abort("connectionrefused");
      return;
    }
    await route.continue();
  });

  // Capture the orchestrator stream specifically.
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/agent/")) {
      const body = await res.body().catch(() => null);
      orchEvents.push({
        url,
        status: res.status(),
        bodyLen: body?.length ?? null,
        bodySnippet: body?.toString("utf8").slice(0, 800) ?? null,
      });
    }
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await page.click('[data-testid="skip-onboarding"]');
  await sleep(800);
  await page.fill('[data-testid="settings-user-id-input"]', "test_e2e_d");
  await page.click('[data-testid="settings-user-id-save"]');
  await sleep(800);
  await page.evaluate(() => {
    /** @type {any} */ (window).__store.getState().closeWindow(
      /** @type {any} */ (window).__store.getState().windows[0]?.id,
    );
  });
  await sleep(400);

  // Click in the center of the page to take focus away from any input.
  await page.mouse.click(720, 400);
  await sleep(200);

  // Open command bar via store directly to avoid keyboard focus issues.
  await page.evaluate(() => {
    /** @type {any} */ (window).__store.getState().setCommandOpen(true);
  });
  await sleep(500);

  // Type query into the focused command bar input.
  const cb = page.locator('[aria-label="agent command bar"] input');
  await cb.waitFor({ timeout: 3000 });
  await cb.click();
  await cb.fill("show me the graph");
  await page.screenshot({
    path: path.join(SHOTS, "12-orch-typed.png"),
  });
  await page.keyboard.press("Enter");

  // Watch the store reply field over a few seconds.
  const samples = [];
  for (let i = 0; i < 18; i++) {
    await sleep(500);
    const snap = await page.evaluate(() => {
      const s = /** @type {any} */ (window).__store?.getState();
      return {
        agentReply: s?.agentReply ?? null,
        lastQuery: s?.lastQuery ?? null,
        commandOpen: s?.commandOpen ?? null,
        windows: (s?.windows ?? []).map((w) => w.kind),
        backendHealth: s?.backendHealth ?? null,
        agentStatus: s?.agentStatus ?? null,
      };
    });
    samples.push({ tick: i, ...snap });
    if (snap.agentReply && snap.agentReply.length > 5) break;
  }
  await sleep(2000);
  await page.screenshot({
    path: path.join(SHOTS, "13-orch-after-stream.png"),
  });

  const final = await page.evaluate(() => {
    const s = /** @type {any} */ (window).__store?.getState();
    const dockText =
      document.querySelector('[data-testid="dock-text"]')?.textContent?.trim() ??
      null;
    return {
      agentReply: s?.agentReply ?? null,
      lastQuery: s?.lastQuery ?? null,
      windows: (s?.windows ?? []).map((w) => ({ kind: w.kind, payload: w.payload })),
      backendHealth: s?.backendHealth ?? null,
      dockText,
      cards: (s?.cards ?? []).map((c) => ({
        kind: c.kind,
        text: /** @type {any} */ (c).data?.text ?? null,
      })),
    };
  });

  await fs.writeFile(
    path.join(ROOT, "orchestrator-reply.json"),
    JSON.stringify({ samples, final, orchEvents }, null, 2),
    "utf8",
  );

  console.log("FINAL:", JSON.stringify(final, null, 2));
  console.log("ORCH EVENTS:", orchEvents.length);
  console.log("LAST SAMPLE:", JSON.stringify(samples.at(-1), null, 2));

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
