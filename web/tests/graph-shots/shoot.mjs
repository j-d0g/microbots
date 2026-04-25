/**
 * Ralph-loop screenshot harness for the graph room.
 *
 * Runs through a matrix of viewport sizes + window placements and a
 * sequence of agent-driven graph interactions, producing PNG snapshots
 * under tests/screenshots/graph/.
 *
 * Usage:
 *   node tests/graph-shots/shoot.mjs           # all
 *   node tests/graph-shots/shoot.mjs --size sm # only sm
 *   node tests/graph-shots/shoot.mjs --tag rest only-rest # filter by tag
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../screenshots/graph");
const APP_URL = process.env.APP_URL || "http://localhost:3000/";

const SIZES = [
  { tag: "xs", w: 480, h: 720 }, // phone-ish narrow
  { tag: "sm", w: 800, h: 600 },
  { tag: "md", w: 1280, h: 800 },
  { tag: "lg", w: 1680, h: 1050 },
  { tag: "xl", w: 2560, h: 1440 },
];

const args = process.argv.slice(2);
const filterIdx = args.indexOf("--size");
const onlySize = filterIdx >= 0 ? args[filterIdx + 1] : null;

const HIDE_DEV_OVERLAYS_CSS = `
  /* hide dev-only chrome that overlays the graph during screenshots */
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
  // Reset windows + open only the graph maximised.
  await page.evaluate(() => {
    const s = (window).__store.getState();
    for (const w of [...s.windows]) s.closeWindow(w.id);
    for (const c of [...s.cards]) s.dismissCard(c.id);
    s.setAgentStatus("");
    s.setOnboarded(true);
    s.openWindow("graph");
    // Maximise to fill desktop minus the dock area.
    const arr = (window).__store.getState();
    const win = arr.windows[arr.windows.length - 1];
    if (win) {
      const dockH = 80;
      const gap = 16;
      arr.updateWindowRect(win.id, {
        x: gap,
        y: gap,
        w: window.innerWidth - gap * 2,
        h: window.innerHeight - dockH - gap * 2,
      });
    }
  });
  // Allow graph layout simulation to settle + final zoom-to-fit on engine stop.
  await page.waitForTimeout(2400);
}

async function ensureStore(page) {
  await page
    .waitForFunction(() => Boolean((window).__store), { timeout: 6000 })
    .catch(async () => {
      // page must have reloaded; redo the setup
      await setup(page);
    });
}

async function shoot(page, size, tag) {
  const path = `${OUT_DIR}/${size.tag}-${tag}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  -> ${path}`);
}

async function dismissCards(page) {
  await page
    .evaluate(() => {
      const s = (window).__store?.getState?.();
      if (!s) return;
      for (const c of [...s.cards]) s.dismissCard(c.id);
      s.setAgentStatus("");
    })
    .catch(() => {});
}

async function actions(page, size) {
  await setup(page);
  await shoot(page, size, "01-initial");

  // Filter to entity layer
  await page
    .getByRole("button", { name: "entity" })
    .first()
    .click({ trial: false })
    .catch(() => {});
  await page.waitForTimeout(700);
  await shoot(page, size, "02-filter-entity");

  // Click "all" again to reset filter
  await page
    .getByRole("button", { name: "all" })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(700);
  await shoot(page, size, "03-filter-cleared");

  // Click a real node via the global graph controller to open inspector
  await ensureStore(page);
  await dismissCards(page);
  await page.evaluate(() => {
    const g = (window).__graph;
    g?.selectNode("ent-product-bugs");
    g?.highlight("ent-product-bugs");
    g?.focusNode("ent-product-bugs");
  });
  await page.waitForTimeout(900);
  await shoot(page, size, "04-inspector");

  // Drive a verb via the agent-store: focus on the user node.
  await ensureStore(page);
  await page.evaluate(() => {
    const s = (window).__store.getState();
    s.emitVerb({ verb: "highlight", args: { node_id: "user-maya" }, at: Date.now() });
  });
  await page.waitForTimeout(900);
  await shoot(page, size, "05-highlight-user");

  // Compare path: highlight a path between two nodes
  await ensureStore(page);
  await dismissCards(page);
  await page.evaluate(() => {
    const g = (window).__graph;
    g?.clear();
    g?.path("user-maya", "wf-bug-triage");
  });
  await page.waitForTimeout(900);
  await shoot(page, size, "06-path");

  // Resize the graph window into a PiP-ish floating panel.
  await ensureStore(page);
  await dismissCards(page);
  await page.evaluate(() => {
    const s = (window).__store.getState();
    const win = s.windows.find((w) => w.kind === "graph");
    if (!win) return;
    s.updateWindowRect(win.id, {
      x: window.innerWidth - 540,
      y: 60,
      w: 480,
      h: 360,
    });
    const g = (window).__graph;
    g?.clear();
  });
  await page.waitForTimeout(1500);
  await shoot(page, size, "07-pip-resized");
}

async function run() {
  const targets = onlySize ? SIZES.filter((s) => s.tag === onlySize) : SIZES;
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const size of targets) {
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
