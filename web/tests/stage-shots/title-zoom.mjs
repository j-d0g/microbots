/**
 * Zoom in on the centre frame title bar to inspect the new shape
 * controls (oval + circle). Captures the title bar area in three
 * states: solo (oval disabled), with a sideline (oval enabled),
 * and the same with the oval hovered to show the indigo tint.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../screenshots/stage");
const APP_URL = process.env.APP_URL || "http://localhost:3000/";

const HIDE = `
  [aria-label*="agent snapshot"], [aria-label*="snapshot inspector"] { display: none !important; }
`;

async function boot(page, kinds) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      window.localStorage.setItem("microbots.onboarded.v2", "true");
    } catch {}
  }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: HIDE }).catch(() => {});
  await page.waitForFunction(() => Boolean(window.__store), { timeout: 8000 });
  await page.evaluate((ks) => {
    const s = window.__store.getState();
    for (const w of [...s.windows]) s.closeWindow(w.id);
    for (const k of ks) s.openWindow(k);
  }, kinds);
  await page.waitForTimeout(700);
}

async function shootTitleStrip(page, tag) {
  /* Framer-motion's animate-only width/height makes the centre frame
     bounding box unreliable. Just take a top-strip page crop — the
     centre window's title bar always lands in the top ~80px of the
     viewport across our test cases. */
  await page.waitForTimeout(700);
  const path = `${OUT_DIR}/zoom-${tag}.png`;
  await page.screenshot({
    path,
    clip: { x: 0, y: 0, width: 1440, height: 100 },
  });
  console.log(`  -> ${path}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  /* Solo: only graph open → oval should be disabled (no swap target) */
  await boot(page, ["graph"]);
  await shootTitleStrip(page, "solo-disabled");

  /* Centre + sideline: graph + settings → oval enabled */
  await boot(page, ["graph", "settings"]);
  await page.waitForTimeout(400);
  await shootTitleStrip(page, "with-sideline");

  /* Hover the swap oval */
  await page.hover('[data-testid="centre-swap"]');
  await page.waitForTimeout(150);
  await shootTitleStrip(page, "swap-hover");

  /* Hover the close circle */
  await page.hover('[data-testid="centre-close"]');
  await page.waitForTimeout(150);
  await shootTitleStrip(page, "close-hover");

  /* Click the swap to verify a clean transition (no flicker) */
  await page.click('[data-testid="centre-swap"]');
  await page.waitForTimeout(420);
  await shootTitleStrip(page, "after-swap");

  await ctx.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
