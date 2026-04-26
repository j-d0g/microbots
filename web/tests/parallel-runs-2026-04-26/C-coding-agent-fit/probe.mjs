/**
 * C — Coding-agent-shaped probe.
 *
 * Submits 5 code-interpreter-style queries against the UI agent (mix of
 * windowed + chat modes) and captures screenshots / store state /
 * console + network signals so we can characterise the gap between
 * what the UI agent does today and what the harness shape (run_code,
 * find_examples, save_workflow, ask_user) would unlock.
 *
 * Run from web/:
 *   node tests/parallel-runs-2026-04-26/C-coding-agent-fit/probe.mjs
 *
 * Server is expected at http://localhost:3001 already.
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;
const SHOTS = resolve(OUT_DIR, "screenshots");
const APP_URL = process.env.APP_URL || "http://localhost:3001/";
const USER_ID = "test_e2e_c";

const QUERIES = [
  {
    id: "01-maths",
    label: "Maths/compute",
    text: "compute the square of 7",
    mode: "windowed",
  },
  {
    id: "02-fetch-parse",
    label: "Fetch/parse (multi-step)",
    text: "fetch https://example.com and tell me how many words it has",
    mode: "chat",
  },
  {
    id: "03-analytical",
    label: "Analytical (logs)",
    text: "find the slowest service in my stack and show me its logs",
    mode: "windowed",
  },
  {
    id: "04-generative",
    label: "Generative (script + schedule)",
    text: "draft a python script that sends a slack message every morning at 9am",
    mode: "chat",
  },
  {
    id: "05-action",
    label: "Action with confirmation",
    text: "post a slack message to #general saying 'hello team'",
    mode: "windowed",
  },
];

/* ---------- helpers ---------- */

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function shoot(page, name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function readStore(page) {
  return page.evaluate(() => {
    if (!window.__store) return null;
    const s = window.__store.getState();
    return {
      uiMode: s.uiMode,
      onboarded: s.onboarded,
      userId: s.userId ?? null,
      chatRoom: s.chatRoom,
      windows: s.windows.map((w) => ({
        id: w.id,
        kind: w.kind,
        slug: w.slug ?? null,
        focused: w.focused ?? false,
      })),
      recentActions: s.recentActions.map((a) => ({
        tool: a.tool,
        args: a.args,
        ok: a.ok,
        t: a.t,
      })),
      agentReply: s.agentReply,
      lastQuery: s.lastQuery,
      chatMessages: (s.chatMessages || []).map((m) => ({
        role: m.role,
        text: m.text,
        room: m.room,
        status: m.status,
      })),
      cards: (s.cards || []).map((c) => ({
        id: c.id,
        kind: c.kind,
        data: c.data,
        ttl: c.ttl,
      })),
      dock: s.dock,
      agentStatus: s.agentStatus,
    };
  });
}

async function setUiMode(page, target) {
  await page.evaluate((m) => {
    const s = window.__store.getState();
    if (s.uiMode !== m) s.toggleUiMode();
  }, target);
  await page.waitForTimeout(250);
}

async function clearWindowsAndReply(page) {
  await page.evaluate(() => {
    const s = window.__store.getState();
    for (const w of [...s.windows]) s.closeWindow(w.id);
    if (typeof s.clearReply === "function") s.clearReply();
    if (typeof s.setLastQuery === "function") s.setLastQuery("");
    // recentActions ring is not cleared (it's a ring buffer — we want
    // to know what the *new* query produced, so we just diff before
    // and after by length).
  });
  await page.waitForTimeout(150);
}

async function submitWindowed(page, query) {
  // CommandBar: hit `/` to open, type, Enter to submit.
  await page.keyboard.press("/");
  await page.waitForTimeout(180);
  // The CommandBar input is the only visible <input placeholder="ask the agent…">.
  const input = page.locator('input[placeholder="ask the agent…"]');
  await input.waitFor({ state: "visible", timeout: 4000 });
  await input.fill(query);
  await page.waitForTimeout(80);
  await input.press("Enter");
}

async function submitChat(page, query) {
  const input = page.getByTestId("chat-input");
  await input.waitFor({ state: "visible", timeout: 4000 });
  await input.fill(query);
  await page.waitForTimeout(80);
  await page.getByTestId("chat-send").click();
}

async function waitForAgentDone(page, { timeout = 30000 } = {}) {
  // Stream is "done" once dock leaves "thinking"/"speaking" and there
  // is either a non-empty reply or an error toast. We poll the store
  // and remember the peak agentReply length seen along the way (it
  // can be cleared by the next clearReply call).
  const start = Date.now();
  let lastReplyLen = 0;
  let peakReply = "";
  let peakChatTail = [];
  let peakCards = [];
  let stableSince = 0;
  while (Date.now() - start < timeout) {
    const s = await readStore(page);
    if (!s) return { settled: false, peakReply, peakChatTail, peakCards };
    const replyLen = (s.agentReply || "").length;
    if (replyLen > peakReply.length) peakReply = s.agentReply;
    if ((s.chatMessages || []).length > peakChatTail.length) {
      peakChatTail = s.chatMessages;
    }
    if ((s.cards || []).length > peakCards.length) peakCards = s.cards;
    const dock = s.dock;
    if ((dock === "idle" || dock === "hidden") && replyLen === lastReplyLen) {
      if (stableSince === 0) stableSince = Date.now();
      else if (Date.now() - stableSince > 1200) {
        return { settled: true, peakReply, peakChatTail, peakCards };
      }
    } else {
      stableSince = 0;
    }
    lastReplyLen = replyLen;
    await page.waitForTimeout(180);
  }
  return { settled: false, peakReply, peakChatTail, peakCards };
}

async function captureSnapshotInspector(page, name) {
  // Cmd+Shift+S toggles the snapshot inspector. Mac-style; on Linux
  // headless playwright, we use Meta+Shift+S which Chromium translates
  // appropriately for the page's keydown listener (handler tests
  // metaKey || ctrlKey). Use Control+Shift+S to be safe.
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyS");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await page.waitForTimeout(280);
  const path = await shoot(page, `${name}-snapshot`);
  // close it again
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyS");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  return path;
}

/* ---------- main ---------- */

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleEntries = [];
  const networkFailures = [];
  const sseSamples = [];

  page.on("console", (msg) => {
    const text = msg.text();
    consoleEntries.push({
      type: msg.type(),
      text,
      ts: Date.now(),
      url: msg.location()?.url ?? null,
    });
  });
  page.on("pageerror", (err) => {
    consoleEntries.push({
      type: "pageerror",
      text: `${err.name}: ${err.message}`,
      ts: Date.now(),
      stack: err.stack,
    });
  });
  page.on("requestfailed", (req) => {
    networkFailures.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText ?? null,
      ts: Date.now(),
    });
  });
  page.on("response", async (res) => {
    const url = res.url();
    const status = res.status();
    if (status >= 400) {
      networkFailures.push({
        url,
        method: res.request().method(),
        status,
        ts: Date.now(),
      });
    }
    // We can't easily read the SSE body without locking the stream,
    // but record the orchestrate calls + their final status for the
    // network-trace correlation.
    if (url.includes("/api/agent/orchestrate") || url.includes("/api/chat")) {
      sseSamples.push({
        url,
        status,
        method: res.request().method(),
        ts: Date.now(),
      });
    }
  });

  /* --- boot --- */
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__store), null, {
    timeout: 15000,
  });

  // Set onboarded + user_id directly via the store. Mirrors the
  // settings-room save logic but skips the UI dance so the rest of the
  // script can focus on agent behaviour.
  await page.evaluate((uid) => {
    const s = window.__store.getState();
    s.setOnboarded(true);
    s.setUserId(uid);
  }, USER_ID);
  await page.waitForTimeout(250);
  await shoot(page, "00-booted-windowed");

  // baseline store before any query
  const baseline = await readStore(page);

  /* --- run each query --- */
  const perQuery = [];
  for (const q of QUERIES) {
    const before = await readStore(page);
    // close windows + reply between queries so we get a clean canvas
    await clearWindowsAndReply(page);
    await setUiMode(page, q.mode);
    await page.waitForTimeout(300);
    await shoot(page, `${q.id}-pre`);

    const sentAt = Date.now();
    let consoleStartLen = consoleEntries.length;
    let networkStartLen = sseSamples.length;
    try {
      if (q.mode === "windowed") await submitWindowed(page, q.text);
      else await submitChat(page, q.text);
    } catch (err) {
      perQuery.push({
        ...q,
        error: `submit failed: ${err.message}`,
      });
      continue;
    }

    await page.waitForTimeout(800);
    await shoot(page, `${q.id}-during`);

    const { settled, peakReply, peakChatTail, peakCards } =
      await waitForAgentDone(page, { timeout: 35000 });
    await page.waitForTimeout(400);
    await shoot(page, `${q.id}-after`);

    const after = await readStore(page);
    const newActions = after?.recentActions ?? [];
    const newConsole = consoleEntries.slice(consoleStartLen);
    const newNetwork = sseSamples.slice(networkStartLen);

    // capture snapshot inspector view (only useful in windowed mode —
    // chat mode hides the chip; the keyboard shortcut still toggles
    // it but the UI is tucked behind chat panel so the screenshot is
    // less useful).
    let snapshotShot = null;
    if (q.mode === "windowed") {
      snapshotShot = await captureSnapshotInspector(page, q.id).catch(
        () => null,
      );
    }

    // dismiss command bar / clear input box for the next round.
    if (q.mode === "windowed") {
      await page.keyboard.press("Escape").catch(() => {});
    }

    perQuery.push({
      ...q,
      sentAt,
      durationMs: Date.now() - sentAt,
      settled,
      uiMode: after?.uiMode,
      windowsAfter: after?.windows ?? [],
      newActions,
      // both the live (post-settle) and the peak-during-stream reply.
      // peak is what actually streamed to the user; live is what's left
      // on the store at the next-query baseline.
      reply: after?.agentReply ?? "",
      peakReply,
      lastQuery: after?.lastQuery ?? "",
      chatTail: (after?.chatMessages ?? []).slice(-6),
      peakChatTail: peakChatTail.slice(-6),
      cardsAfter: (after?.cards ?? []).map((c) => ({
        kind: c.kind,
        data: c.data,
      })),
      peakCards: peakCards.map((c) => ({ kind: c.kind, data: c.data })),
      snapshotShot,
      newConsoleSample: newConsole.slice(0, 12),
      newNetworkSample: newNetwork,
    });
  }

  /* --- final screenshots: open Stack and Workflow rooms directly --- */
  await clearWindowsAndReply(page);
  await setUiMode(page, "chat");
  await page.evaluate(() => {
    window.__store.getState().setChatRoom("stack");
  });
  await page.waitForTimeout(500);
  await shoot(page, "99-chat-room-stack");

  await page.evaluate(() => {
    window.__store.getState().setChatRoom("workflow");
  });
  await page.waitForTimeout(500);
  await shoot(page, "99-chat-room-workflow");

  // Look at the FloatingDock for any "code"/"interpreter" affordance.
  await setUiMode(page, "windowed");
  await page.waitForTimeout(400);
  await shoot(page, "99-floating-dock");

  /* --- write artefacts --- */
  await writeFile(
    `${OUT_DIR}/console-errors.json`,
    JSON.stringify(consoleEntries, null, 2),
  );
  await writeFile(
    `${OUT_DIR}/network-failures.json`,
    JSON.stringify(networkFailures, null, 2),
  );
  await writeFile(
    `${OUT_DIR}/sse-samples.json`,
    JSON.stringify(sseSamples, null, 2),
  );
  await writeFile(
    `${OUT_DIR}/per-query.json`,
    JSON.stringify({ baseline, queries: perQuery }, null, 2),
  );

  await browser.close();

  console.log(`[probe] done — ${perQuery.length} queries`);
  for (const q of perQuery) {
    console.log(
      `  - ${q.id} (${q.mode}, ${q.durationMs ?? "?"}ms): reply="${(q.reply || "").slice(0, 100)}…"`,
    );
  }
}

main().catch((err) => {
  console.error("[probe] crashed:", err);
  process.exit(1);
});
