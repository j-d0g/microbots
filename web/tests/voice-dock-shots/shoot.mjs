/**
 * Voice + dock screenshot harness.
 *
 * Verifies:
 *  - windows extend to the viewport bottom (the 80px reserve is gone)
 *  - dock idle pill
 *  - dock listening (with a transcript appearing above)
 *  - dock speaking (with the agent reply appearing above)
 *
 * Run: node tests/voice-dock-shots/shoot.mjs
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../screenshots/voice-dock");
const APP_URL = process.env.APP_URL || "http://localhost:3000/";

const SIZES = [
  { tag: "md", w: 1280, h: 800 },
  { tag: "lg", w: 1680, h: 1050 },
];

const HIDE_DEV_OVERLAYS_CSS = `
  [aria-label*="agent snapshot"], [aria-label*="snapshot inspector"] { display: none !important; }
`;

async function setup(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: HIDE_DEV_OVERLAYS_CSS }).catch(() => {});
    await page
      .locator("[data-testid=skip-onboarding]")
      .click({ timeout: 2500 })
      .catch(() => {});
    try {
      await page.waitForFunction(
        () => Boolean((window).__store),
        { timeout: 8000 },
      );
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      await page.waitForTimeout(800);
    }
  }
  // Reset windows + cards, open Brief + Graph side-by-side.
  await page.evaluate(() => {
    const s = (window).__store.getState();
    for (const w of [...s.windows]) s.closeWindow(w.id);
    for (const c of [...s.cards]) s.dismissCard(c.id);
    s.setAgentStatus("");
    s.setOnboarded(true);
    s.openWindow("graph");
    s.openWindow("settings");
    s.arrangeWindows("split");
  });
  await page.waitForTimeout(900);
}

async function shoot(page, size, tag) {
  const path = `${OUT_DIR}/${size.tag}-${tag}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  -> ${path}`);
}

async function actions(page, size) {
  await setup(page);

  // 1. Idle dock with windows extending to the bottom edge.
  await shoot(page, size, "01-idle");

  // 2. Listening: synthesise a live transcript so the dock expands.
  await page.evaluate(() => {
    const s = (window).__store.getState();
    s.setDock("listening");
    s.appendTranscript("every morning I end up triaging the same product bugs from Slack into Linear");
  });
  await page.waitForTimeout(400);
  await shoot(page, size, "02-listening");

  // 3. Speaking: simulate the agent finishing a reply.
  await page.evaluate(() => {
    const s = (window).__store.getState();
    s.clearTranscript();
    s.setDock("speaking");
    s.startReply("morning brief, please");
    const text =
      "morning. you have six proposals queued. the highest-confidence one is the auto-triage of slack #product-bugs into linear. ready when you are.";
    s.appendReply(text);
  });
  await page.waitForTimeout(400);
  await shoot(page, size, "03-speaking");

  // 4. Back to idle to verify the dock collapses.
  await page.evaluate(() => {
    const s = (window).__store.getState();
    s.setDock("idle");
    s.clearReply();
  });
  await page.waitForTimeout(400);
  await shoot(page, size, "04-back-to-idle");
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const size of SIZES) {
      console.log(`\n[${size.tag}] ${size.w}x${size.h}`);
      const ctx = await browser.newContext({
        viewport: { width: size.w, height: size.h },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      try {
        await actions(page, size);
      } catch (err) {
        console.error(`  ${size.tag} failed:`, err.message);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
