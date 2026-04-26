/**
 * Push-to-talk integration test.
 *
 * Verifies that holding `.` toggles dock=listening, releasing it stops
 * STT, and the user does NOT need to press `.` twice.
 *
 *  Run: node tests/voice-dock-shots/ptt.mjs
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../screenshots/voice-dock");
const APP_URL = process.env.APP_URL || "http://localhost:3000/";

const HIDE = `
  [aria-label*="agent snapshot"], [aria-label*="snapshot inspector"] { display: none !important; }
`;

async function setup(page) {
  /* The voice pipeline auto-submits the transcript after each release,
     which would normally fire the orchestrate agent and toggle the
     dock for ~2 seconds — that interferes with cycle-to-cycle assertions.
     Stub the orchestrate endpoint to return an instantly-finished SSE
     so the STT lifecycle is the only thing under test. */
  await page.route("**/api/agent/orchestrate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"type":"reply.done"}\n\n',
    }),
  );
  for (let i = 0; i < 3; i++) {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: HIDE }).catch(() => {});
    await page
      .locator("[data-testid=skip-onboarding]")
      .click({ timeout: 2500 })
      .catch(() => {});
    try {
      await page.waitForFunction(() => Boolean((window).__store), { timeout: 8000 });
      break;
    } catch {
      if (i === 2) throw new Error("store never loaded");
      await page.waitForTimeout(800);
    }
  }
  await page.evaluate(() => {
    const s = (window).__store.getState();
    for (const w of [...s.windows]) s.closeWindow(w.id);
    for (const c of [...s.cards]) s.dismissCard(c.id);
    s.setAgentStatus("");
    s.setOnboarded(true);
    s.openWindow("graph");
  });
  // Wait for VoiceBridge to mount and expose the handle.
  await page.waitForFunction(
    () => Boolean((window).__voice),
    { timeout: 5000 },
  );
}

async function dockState(page) {
  return page.evaluate(() => (window).__store.getState().dock);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  const failures = [];
  try {
    await setup(page);

    /* 1. Press `.` for ~600ms, release, expect dock to:
          - stay "listening" for the 400ms tail window
          - leave listening shortly after the tail expires
          - reach idle without a second key press --------------- */
    console.log("[ptt] holding `.` for 600ms");
    await page.keyboard.down(".");
    await page.waitForTimeout(120);
    const stateWhileHeld = await dockState(page);
    if (stateWhileHeld !== "listening") {
      failures.push(
        `expected dock=listening while holding, got ${stateWhileHeld}`,
      );
    }
    await page.screenshot({ path: `${OUT_DIR}/ptt-01-holding.png` });

    await page.waitForTimeout(480);
    await page.keyboard.up(".");

    /* During the tail window (default 400ms): mic must still be open
       so trailing words land in the transcript. */
    await page.waitForTimeout(150);
    const stateMidTail = await dockState(page);
    if (stateMidTail !== "listening") {
      failures.push(
        `expected dock=listening during tail window, got ${stateMidTail}`,
      );
    }

    /* Wait past the tail (400ms total + a buffer for transcription). */
    await page.waitForTimeout(900);
    const stateAfterRelease = await dockState(page);
    if (stateAfterRelease === "listening") {
      failures.push(
        `expected dock != listening after tail expired, still listening`,
      );
    }
    await page.screenshot({ path: `${OUT_DIR}/ptt-02-released.png` });

    /* 2. Tap `.` quickly (down and up in the same frame) — this is
          the case that used to strand the recorder. ------------- */
    console.log("[ptt] quick tap on `.`");
    await page.keyboard.press("."); // down + up in one call
    await page.waitForTimeout(800);
    const stateAfterTap = await dockState(page);
    if (stateAfterTap === "listening") {
      failures.push(
        `quick tap left dock listening — should never strand the recorder`,
      );
    }
    await page.screenshot({ path: `${OUT_DIR}/ptt-03-after-quick-tap.png` });

    /* 3. Repeat hold-and-release immediately after — the second hold
          must start cleanly even if the first stop is still finalising. */
    console.log("[ptt] second hold");
    await page.keyboard.down(".");
    await page.waitForTimeout(140);
    const second = await dockState(page);
    if (second !== "listening") {
      failures.push(`second hold did not enter listening (got ${second})`);
    }
    await page.keyboard.up(".");
    await page.waitForTimeout(900);
    const settled = await dockState(page);
    if (settled === "listening") {
      failures.push(`second release did not stop listening`);
    }
    await page.screenshot({ path: `${OUT_DIR}/ptt-04-second-cycle.png` });

    /* 4. Re-press during the tail window must resume the same session
          (no second mic prompt) and stay in listening once the tail
          would have fired. ------------------------------------ */
    console.log("[ptt] re-press during tail extends listen");
    await page.keyboard.down(".");
    await page.waitForTimeout(140);
    await page.keyboard.up(".");
    // Wait halfway through the tail (the window is 400ms by default).
    await page.waitForTimeout(180);
    // Re-press: this should cancel the pending stop.
    await page.keyboard.down(".");
    // Now wait LONGER than a fresh tail would last; if cancellation
    // failed we'd have flipped out of listening by now.
    await page.waitForTimeout(550);
    const stillListening = await dockState(page);
    if (stillListening !== "listening") {
      failures.push(
        `re-press during tail did not resume — dock=${stillListening}`,
      );
    }
    await page.keyboard.up(".");
    await page.waitForTimeout(900);
    const finalIdle = await dockState(page);
    if (finalIdle === "listening") {
      failures.push(`final release after extended hold did not stop`);
    }
    await page.screenshot({ path: `${OUT_DIR}/ptt-05-tail-resume.png` });
  } finally {
    await ctx.close();
    await browser.close();
  }

  if (failures.length) {
    console.error(`\nFAIL: ${failures.length} assertion(s):`);
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
  console.log("\nPASS: push-to-talk hold→release works in a single cycle.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
