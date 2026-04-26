/**
 * Ralph-loop screenshot harness for non-graph rooms.
 *
 * For each (room, size) pair, opens the room maximised inside the
 * desktop, exercises the room's agent-callable tools, and snapshots
 * each interaction step into tests/screenshots/rooms/<room>/.
 *
 * Usage:
 *   node tests/room-shots/shoot.mjs                # all rooms, all sizes
 *   node tests/room-shots/shoot.mjs --room brief   # one room
 *   node tests/room-shots/shoot.mjs --size sm      # one size
 *   node tests/room-shots/shoot.mjs --size sm --room brief
 *
 * Assumes `npm run dev` is running on localhost:3000.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../screenshots/rooms");
const APP_URL = process.env.APP_URL || "http://localhost:3000/";

const SIZES = [
  { tag: "xs", w: 480, h: 720 },
  { tag: "sm", w: 800, h: 600 },
  { tag: "md", w: 1280, h: 800 },
  { tag: "lg", w: 1680, h: 1050 },
  { tag: "xl", w: 2560, h: 1440 },
];

const ROOMS = ["brief", "workflow", "stack", "waffle", "playbooks", "settings"];

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const onlySize = argVal("--size");
const onlyRoom = argVal("--room");

async function bootRoom(page, room) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  // StoreBridge always mounts now -- so __store is available regardless of onboarding.
  await page.waitForFunction(() => Boolean(window.__store), null, {
    timeout: 15000,
  });
  await page.evaluate((kind) => {
    const s = window.__store.getState();
    for (const w of [...s.windows]) s.closeWindow(w.id);
    s.setOnboarded(true);
    s.openWindow(kind);
    const arr = window.__store.getState();
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
  }, room);
  await page.waitForTimeout(300);
  await page
    .waitForFunction(
      (kind) => Boolean(window.__roomTools && window.__roomTools[kind]),
      room,
      { timeout: 6000 },
    )
    .catch(() => {});
  await page.waitForTimeout(250);
}

async function callTool(page, room, tool, toolArgs = {}) {
  return page.evaluate(
    ({ room, tool, toolArgs }) => {
      const set = window.__roomTools?.[room];
      if (!set) return { ok: false, reason: `no tools for ${room}` };
      return Promise.resolve(set.call(tool, toolArgs)).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, reason: String(e) }),
      );
    },
    { room, tool, toolArgs },
  );
}

async function shoot(page, room, sizeTag, label) {
  await mkdir(`${OUT_DIR}/${room}`, { recursive: true });
  const path = `${OUT_DIR}/${room}/${sizeTag}-${label}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  -> ${path}`);
}

const SCRIPTS = {
  brief: async (page, sizeTag) => {
    await shoot(page, "brief", sizeTag, "01-initial");
    await callTool(page, "brief", "filter", { tone: "high" });
    await page.waitForTimeout(250);
    await shoot(page, "brief", sizeTag, "02-filter-high");
    await callTool(page, "brief", "filter", { tone: "all" });
    await page.waitForTimeout(200);
    await callTool(page, "brief", "expand", { id: "bp-001" });
    await page.waitForTimeout(250);
    await shoot(page, "brief", sizeTag, "03-expanded");
    await callTool(page, "brief", "scroll_to", { id: "bp-006" });
    await page.waitForTimeout(450);
    await shoot(page, "brief", sizeTag, "04-scroll-bottom");
    await callTool(page, "brief", "scroll_to", { section: "yesterday" });
    await page.waitForTimeout(450);
    await shoot(page, "brief", sizeTag, "05-yesterday");
  },
  workflow: async (page, sizeTag) => {
    await shoot(page, "workflow", sizeTag, "01-list");
    await callTool(page, "workflow", "filter", { integration: "slack" });
    await page.waitForTimeout(250);
    await shoot(page, "workflow", sizeTag, "02-filter-slack");
    await callTool(page, "workflow", "filter", { integration: null });
    await page.waitForTimeout(150);
    await callTool(page, "workflow", "select", { slug: "bug-triage-pipeline" });
    await page.waitForTimeout(300);
    await shoot(page, "workflow", sizeTag, "03-detail-recipe");
    await callTool(page, "workflow", "show_dag", {});
    await page.waitForTimeout(250);
    await shoot(page, "workflow", sizeTag, "04-detail-dag");
    await callTool(page, "workflow", "back", {});
    await page.waitForTimeout(200);
    await shoot(page, "workflow", sizeTag, "05-back");
  },
  stack: async (page, sizeTag) => {
    await shoot(page, "stack", sizeTag, "01-grid");
    await callTool(page, "stack", "filter", { health: "warn" });
    await page.waitForTimeout(250);
    await shoot(page, "stack", sizeTag, "02-filter-warn");
    await callTool(page, "stack", "filter", { health: "all" });
    await page.waitForTimeout(150);
    await callTool(page, "stack", "select", { slug: "notion-scribe" });
    await page.waitForTimeout(300);
    await shoot(page, "stack", sizeTag, "03-logs");
    await callTool(page, "stack", "scroll_to", { slug: "slack-linear-bridge" });
    await page.waitForTimeout(300);
    await shoot(page, "stack", sizeTag, "04-scroll-target");
  },
  waffle: async (page, sizeTag) => {
    await shoot(page, "waffle", sizeTag, "01-idle");
    await callTool(page, "waffle", "set_state", { state: "listening" });
    await page.waitForTimeout(200);
    await shoot(page, "waffle", sizeTag, "02-listening");
    await callTool(page, "waffle", "set_transcript", {
      text: "Move the bug triage assignment confidence threshold up to 0.92, and re-run the proposer overnight.",
    });
    await page.waitForTimeout(200);
    await shoot(page, "waffle", sizeTag, "03-transcript");
    await callTool(page, "waffle", "set_state", { state: "thinking" });
    await page.waitForTimeout(150);
    await shoot(page, "waffle", sizeTag, "04-thinking");
    await callTool(page, "waffle", "set_state", { state: "idle" });
    await callTool(page, "waffle", "set_transcript", { text: "" });
  },
  playbooks: async (page, sizeTag) => {
    await shoot(page, "playbooks", sizeTag, "01-grid");
    await callTool(page, "playbooks", "filter", { column: "suggested" });
    await page.waitForTimeout(250);
    await shoot(page, "playbooks", sizeTag, "02-suggested-only");
    await callTool(page, "playbooks", "filter", { column: "all" });
    await page.waitForTimeout(150);
    await callTool(page, "playbooks", "filter", { integration: "slack" });
    await page.waitForTimeout(250);
    await shoot(page, "playbooks", sizeTag, "03-integration-slack");
    await callTool(page, "playbooks", "filter", { integration: null });
    await page.waitForTimeout(150);
    await callTool(page, "playbooks", "scroll_to", { title: "Standup assembler" });
    await page.waitForTimeout(450);
    await shoot(page, "playbooks", sizeTag, "04-scroll-target");
  },
  settings: async (page, sizeTag) => {
    await shoot(page, "settings", sizeTag, "01-top");
    await callTool(page, "settings", "scroll_to", { section: "members" });
    await page.waitForTimeout(400);
    await shoot(page, "settings", sizeTag, "02-members");
    await callTool(page, "settings", "scroll_to", { section: "memory" });
    await page.waitForTimeout(400);
    await shoot(page, "settings", sizeTag, "03-memory");
    await callTool(page, "settings", "scroll_to", { section: "danger" });
    await page.waitForTimeout(400);
    await shoot(page, "settings", sizeTag, "04-danger");
    await callTool(page, "settings", "filter", { integrations: "disconnected" });
    await callTool(page, "settings", "scroll_to", { section: "integrations" });
    await page.waitForTimeout(400);
    await shoot(page, "settings", sizeTag, "05-disconnected-only");
  },
};

async function run() {
  const sizes = onlySize ? SIZES.filter((s) => s.tag === onlySize) : SIZES;
  const rooms = onlyRoom ? [onlyRoom] : ROOMS;
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const room of rooms) {
      const script = SCRIPTS[room];
      if (!script) {
        console.warn(`skip unknown room: ${room}`);
        continue;
      }
      console.log(`\n[room: ${room}]`);
      for (const size of sizes) {
        console.log(`  [${size.tag}] ${size.w}x${size.h}`);
        const ctx = await browser.newContext({
          viewport: { width: size.w, height: size.h },
          deviceScaleFactor: 2,
        });
        const page = await ctx.newPage();
        try {
          await bootRoom(page, room);
          await script(page, size.tag);
        } catch (err) {
          console.error(`    failed:`, err.message);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
