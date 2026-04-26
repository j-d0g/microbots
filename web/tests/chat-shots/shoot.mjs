/**
 * Ralph-loop screenshot harness for chat mode.
 *
 * For each viewport size, switches the UI to chat mode, walks through
 * the embedded rooms, fires a few user/agent messages, and exercises
 * a couple of in-window tools — to verify the layout holds at every
 * size and that the agent's per-window navigation still works
 * inside the embedded right pane.
 *
 * Usage:
 *   node tests/chat-shots/shoot.mjs
 *   node tests/chat-shots/shoot.mjs --size md
 *   node tests/chat-shots/shoot.mjs --room playbooks
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../screenshots/chat");
const APP_URL = process.env.APP_URL || "http://localhost:3000/";

const SIZES = [
  { tag: "xs", w: 480, h: 720 },
  { tag: "sm", w: 800, h: 600 },
  { tag: "md", w: 1280, h: 800 },
  { tag: "lg", w: 1680, h: 1050 },
  { tag: "xl", w: 2560, h: 1440 },
];

const ROOMS_TO_VISIT = [
  "brief",
  "workflow",
  "stack",
  "waffle",
  "playbooks",
  "settings",
];

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const onlySize = argVal("--size");
const onlyRoom = argVal("--room");

async function bootChatMode(page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__store), null, {
    timeout: 15000,
  });
  await page.evaluate(() => {
    const s = window.__store.getState();
    s.setOnboarded(true);
    for (const w of [...s.windows]) s.closeWindow(w.id);
    s.clearChatHistory();
    s.setChatRoom("brief");
    s.setUiMode("chat");
  });
  await page.waitForTimeout(400);
  // Wait for embedded room to mount + register its tools.
  await page
    .waitForFunction(
      () =>
        Boolean(
          window.__roomTools && window.__roomTools["brief"],
        ),
      null,
      { timeout: 6000 },
    )
    .catch(() => {});
  await page.waitForTimeout(250);
}

async function setRoom(page, room) {
  await page.evaluate((r) => {
    window.__store.getState().setChatRoom(r);
  }, room);
  await page.waitForTimeout(300);
  await page
    .waitForFunction(
      (r) => Boolean(window.__roomTools && window.__roomTools[r]),
      room,
      { timeout: 4000 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
}

async function pushUserMsg(page, text) {
  await page.evaluate((t) => {
    const s = window.__store.getState();
    s.appendChatMessage({
      id: `user-${Date.now()}`,
      role: "user",
      text: t,
      ts: Date.now(),
      room: s.chatRoom,
      status: "done",
    });
  }, text);
}

async function pushAgentMsg(page, text) {
  await page.evaluate((t) => {
    const s = window.__store.getState();
    s.appendChatMessage({
      id: `agent-${Date.now()}`,
      role: "agent",
      text: t,
      ts: Date.now(),
      room: s.chatRoom,
      status: "done",
    });
  }, text);
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

async function shoot(page, sizeTag, label) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${sizeTag}-${label}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  -> ${path}`);
}

const ROOM_FLOW = {
  brief: async (page, sizeTag) => {
    await pushUserMsg(page, "what's on the brief?");
    await pushAgentMsg(
      page,
      "six proposals for you today. bug triage and PR digest are highest confidence.",
    );
    await callTool(page, "brief", "filter", { tone: "high" });
    await page.waitForTimeout(300);
    await shoot(page, sizeTag, "brief-01-filtered");
    await pushUserMsg(page, "show me the bug triage one");
    await pushAgentMsg(
      page,
      "expanded the bug-triage proposal so you can see the recipe.",
    );
    await callTool(page, "brief", "filter", { tone: "all" });
    await callTool(page, "brief", "expand", { id: "bp-001" });
    await page.waitForTimeout(400);
    await shoot(page, sizeTag, "brief-02-expanded");
  },
  workflow: async (page, sizeTag) => {
    await pushUserMsg(page, "open the bug triage workflow");
    await pushAgentMsg(
      page,
      "here is the bug triage pipeline -- five steps top to bottom.",
    );
    await callTool(page, "workflow", "select", { slug: "bug-triage-pipeline" });
    await page.waitForTimeout(350);
    await shoot(page, sizeTag, "workflow-01-recipe");
    await pushUserMsg(page, "show me the dag");
    await pushAgentMsg(page, "switched to the dag view.");
    await callTool(page, "workflow", "show_dag", {});
    await page.waitForTimeout(300);
    await shoot(page, sizeTag, "workflow-02-dag");
  },
  stack: async (page, sizeTag) => {
    await pushUserMsg(page, "anything wrong with my stack?");
    await pushAgentMsg(
      page,
      "notion-scribe is in warn -- approaching the Notion API rate limit.",
    );
    await callTool(page, "stack", "filter", { health: "warn" });
    await page.waitForTimeout(300);
    await shoot(page, sizeTag, "stack-01-warn");
    await pushUserMsg(page, "show me the logs");
    await pushAgentMsg(page, "opened the recent logs for notion-scribe.");
    await callTool(page, "stack", "filter", { health: "all" });
    await callTool(page, "stack", "select", { slug: "notion-scribe" });
    await page.waitForTimeout(350);
    await shoot(page, sizeTag, "stack-02-logs");
  },
  waffle: async (page, sizeTag) => {
    await pushUserMsg(page, "I want to talk");
    await pushAgentMsg(page, "ready when you are. hold the dot to record.");
    await callTool(page, "waffle", "set_state", { state: "listening" });
    await callTool(page, "waffle", "set_transcript", {
      text: "raise my bug-triage threshold to 0.92 and re-run the proposer overnight.",
    });
    await page.waitForTimeout(300);
    await shoot(page, sizeTag, "waffle-01-listening");
    await callTool(page, "waffle", "set_state", { state: "idle" });
    await callTool(page, "waffle", "set_transcript", { text: "" });
  },
  playbooks: async (page, sizeTag) => {
    await pushUserMsg(page, "what playbooks would suit me?");
    await pushAgentMsg(
      page,
      "three suggested for you: weekly OKR check-in, inbox zero co-pilot, dep audit reminder.",
    );
    await callTool(page, "playbooks", "filter", { column: "suggested" });
    await page.waitForTimeout(300);
    await shoot(page, sizeTag, "playbooks-01-suggested");
    await pushUserMsg(page, "highlight the standup assembler");
    await pushAgentMsg(page, "found it under network -- 34 orgs use it.");
    await callTool(page, "playbooks", "filter", { column: "all" });
    await callTool(page, "playbooks", "scroll_to", {
      title: "Standup assembler",
    });
    await page.waitForTimeout(450);
    await shoot(page, sizeTag, "playbooks-02-highlight");
  },
  settings: async (page, sizeTag) => {
    await pushUserMsg(page, "who's on the team?");
    await pushAgentMsg(page, "Maya owner, Raj admin, Sofia member.");
    await callTool(page, "settings", "scroll_to", { section: "members" });
    await page.waitForTimeout(400);
    await shoot(page, sizeTag, "settings-01-members");
    await pushUserMsg(page, "show me only the disconnected integrations");
    await pushAgentMsg(page, "notion and perplexity are both disconnected.");
    await callTool(page, "settings", "filter", {
      integrations: "disconnected",
    });
    await callTool(page, "settings", "scroll_to", { section: "integrations" });
    await page.waitForTimeout(400);
    await shoot(page, sizeTag, "settings-02-disconnected");
  },
};

async function run() {
  const sizes = onlySize ? SIZES.filter((s) => s.tag === onlySize) : SIZES;
  const rooms = onlyRoom ? [onlyRoom] : ROOMS_TO_VISIT;
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const size of sizes) {
      console.log(`\n[${size.tag}] ${size.w}x${size.h}`);
      const ctx = await browser.newContext({
        viewport: { width: size.w, height: size.h },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      try {
        await bootChatMode(page);
        await shoot(page, size.tag, "00-empty");
        for (const room of rooms) {
          await setRoom(page, room);
          await shoot(page, size.tag, `${room}-00-initial`);
          const flow = ROOM_FLOW[room];
          if (flow) await flow(page, size.tag);
        }
      } catch (err) {
        console.error(`  failed:`, err.message);
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
