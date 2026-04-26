/**
 * Stage manager + onboarding screenshot harness.
 *
 * Captures:
 *   - onboarding cold-open / interactions / stage steps
 *   - empty desk (no windows)
 *   - single centre-stage window
 *   - centre + 2 sidelines
 *   - centre + many sidelines (overflow demo)
 *   - sideline → centre swap (after click)
 *
 * Run: node tests/stage-shots/shoot.mjs
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

async function gotoFresh(page) {
  /* On the FIRST navigation we want a clean localStorage (so the
     onboarding shows). After that navigations preserve whatever the
     test sets — which is why we don't use addInitScript here. */
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page
    .evaluate(() => {
      try {
        window.localStorage.removeItem("microbots.onboarded.v2");
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: HIDE }).catch(() => {});
  await page.waitForFunction(
    () => Boolean((window).__store),
    { timeout: 8000 },
  );
}

async function gotoExisting(page) {
  /* Used after the user has dismissed onboarding — preserve the flag
     in localStorage. */
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: HIDE }).catch(() => {});
  await page.waitForFunction(
    () => Boolean((window).__store),
    { timeout: 8000 },
  );
}

async function dismissOnboarding(page) {
  await page
    .locator("[data-testid=skip-onboarding]")
    .click({ timeout: 2000 })
    .catch(() => {});
}

async function resetWindows(page, kinds = []) {
  await page.evaluate((kinds_) => {
    const s = (window).__store.getState();
    for (const w of [...s.windows]) s.closeWindow(w.id);
    for (const c of [...s.cards]) s.dismissCard(c.id);
    s.setAgentStatus("");
    for (const k of kinds_) {
      s.openWindow(k);
    }
  }, kinds);
  await page.waitForTimeout(300);
}

async function shoot(page, tag) {
  const path = `${OUT_DIR}/${tag}.png`;
  await page.screenshot({ path, fullPage: false });
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

  /* 1. Onboarding — cold open */
  await gotoFresh(page);
  await page.waitForTimeout(500);
  await shoot(page, "01-onboarding-cold");

  /* 2. Onboarding — interactions */
  await page.locator("[data-testid=onboarding-next]").click();
  await page.waitForTimeout(420);
  await shoot(page, "02-onboarding-interactions");

  /* 3. Onboarding — stage principle */
  await page.locator("[data-testid=onboarding-next]").click();
  await page.waitForTimeout(420);
  await shoot(page, "03-onboarding-stage");

  /* 4. Begin → empty desk */
  await page.locator("[data-testid=onboarding-next]").click();
  await page.waitForTimeout(420);
  await shoot(page, "04-empty-desk");

  /* 5. Single centre-stage window (graph) */
  await resetWindows(page, ["graph"]);
  await page.waitForTimeout(900);
  await shoot(page, "05-centre-solo");

  /* 6. Centre + 2 sidelines */
  await resetWindows(page, ["graph", "settings", "search_memory"]);
  await page.waitForTimeout(900);
  await shoot(page, "06-centre-plus-sidelines");

  /* 7. Centre + 5 sidelines (3 right, 2 left, etc) */
  await resetWindows(page, [
    "graph",
    "settings",
    "search_memory",
    "list_workflows",
    "find_examples",
    "run_code",
  ]);
  await page.waitForTimeout(1100);
  await shoot(page, "07-many-sidelines");

  /* 8. Click a sideline to swap to centre */
  const sideline = await page
    .locator('[data-testid^="sideline-"]')
    .first();
  await sideline.click();
  await page.waitForTimeout(900);
  await shoot(page, "08-sideline-promoted");

  /* 9. Onboarding hidden after dismissal — reload should NOT show */
  await page.evaluate(() =>
    window.localStorage.setItem("microbots.onboarded.v2", "true"),
  );
  await gotoExisting(page);
  await page.waitForTimeout(500);
  const overlayPresent = await page
    .locator("[data-testid=onboarding-overlay]")
    .isVisible()
    .catch(() => false);
  if (overlayPresent) {
    console.error("FAIL: onboarding still showing after dismissal");
    process.exit(1);
  }
  await resetWindows(page, ["graph", "settings"]);
  await page.waitForTimeout(800);
  await shoot(page, "09-return-visit");

  await ctx.close();
  await browser.close();
  console.log("\nPASS: stage + onboarding shots captured.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
