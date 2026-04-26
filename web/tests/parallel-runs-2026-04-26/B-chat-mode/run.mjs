/**
 * E2E test for chat mode UX, persistent history, mode-toggle context.
 *
 * Captures screenshots/, console-errors.json, network-failures.json.
 * Run from web/ as cwd.
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname; // we're already in B-chat-mode/
const SHOTS = resolve(OUT_DIR, "screenshots");
const APP_URL = process.env.APP_URL || "http://localhost:3001/";

const QUERIES = [
  "good morning",
  "show me what's broken",
  "open the workflow for triaging bugs",
  "compare slack and gmail",
  "i'm anxious about friday",
];

const SETTLE_MS = 8000;

async function settle(page, ms = SETTLE_MS) {
  // Wait for the busy cycle: textarea goes disabled → re-enabled.
  const start = Date.now();
  // Phase 1: wait up to 2s for busy to flip true (textarea disabled).
  let sawBusy = false;
  while (Date.now() - start < 2000) {
    const disabled = await page
      .evaluate(() => {
        const ta = document.querySelector('[data-testid="chat-input"]');
        return ta ? ta.disabled : false;
      })
      .catch(() => false);
    if (disabled) {
      sawBusy = true;
      break;
    }
    await page.waitForTimeout(50);
  }
  // Phase 2: wait for busy to flip back to false.
  while (Date.now() - start < ms) {
    const disabled = await page
      .evaluate(() => {
        const ta = document.querySelector('[data-testid="chat-input"]');
        return ta ? ta.disabled : false;
      })
      .catch(() => false);
    if (!disabled) {
      // Extra wait for any tail events (reply.done, room swap, tool actions).
      await page.waitForTimeout(500);
      return { sawBusy, timedOut: false };
    }
    await page.waitForTimeout(150);
  }
  return { sawBusy, timedOut: true };
}

async function snap(page, label) {
  const path = `${SHOTS}/${label}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  -> ${label}.png`);
}

async function snapPanel(page, label) {
  const panel = await page.$('[data-testid="chat-panel"]');
  if (!panel) {
    await snap(page, label);
    return;
  }
  const path = `${SHOTS}/${label}.png`;
  await panel.screenshot({ path });
  console.log(`  -> ${label}.png (panel)`);
}

async function getChatHistory(page) {
  return page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('[data-testid="chat-message-list"] li'),
    );
    return items.map((li, i) => {
      const role = li.querySelector("[data-testid^='chat-msg-']");
      const headerLabel = role
        ? role
            .querySelector("header span:first-child")
            ?.textContent?.trim() || ""
        : "";
      const text = role?.querySelector("p")?.textContent?.trim() || "";
      const status = role?.getAttribute("data-status") || "";
      return { i, role: headerLabel, text, status };
    });
  });
}

async function getEmbeddedRoom(page) {
  return page.evaluate(() => {
    const label = document
      .querySelector('[data-testid="embedded-room-label"]')
      ?.textContent?.trim() || "";
    const containers = Array.from(
      document.querySelectorAll('[data-testid^="embedded-room-"]'),
    ).filter((el) => el.getAttribute("data-testid") !== "embedded-room-label");
    const which = containers[0]?.getAttribute("data-testid") || "";
    return { label, which };
  });
}

async function run() {
  await mkdir(SHOTS, { recursive: true });

  const consoleErrors = [];
  const networkFailures = [];
  const perQuery = [];

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleErrors.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location(),
        ts: new Date().toISOString(),
      });
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push({
      type: "pageerror",
      text: err.message,
      stack: err.stack,
      ts: new Date().toISOString(),
    });
  });
  page.on("requestfailed", (req) => {
    networkFailures.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText,
      ts: new Date().toISOString(),
    });
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400) {
      networkFailures.push({
        url: resp.url(),
        status: resp.status(),
        method: resp.request().method(),
        ts: new Date().toISOString(),
      });
    }
  });

  try {
    /* --- Step 1+2: launch + onboarding + user_id --- */
    console.log("[1] goto app");
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(() => Boolean(window.__store), null, { timeout: 15000 })
      .catch(() => {});
    await snap(page, "01-initial-onboarding");

    // Click breathing dot or skip-to-settings
    const skipBtn = await page.$('[data-testid="skip-onboarding"]');
    if (skipBtn) {
      await skipBtn.click();
    } else {
      await page.click('[data-testid="onboarding-dot"]');
    }
    await page.waitForTimeout(500);

    // Set user_id in settings
    console.log("[2] set user_id");
    const input = await page.waitForSelector(
      '[data-testid="settings-user-id-input"]',
      { timeout: 5000 },
    );
    await input.fill("test_e2e_b");
    await page.click('[data-testid="settings-user-id-save"]');
    await page.waitForTimeout(800);
    await snap(page, "02-userid-saved");

    // Close settings windows so we have a clean canvas before toggling chat.
    await page.evaluate(() => {
      const s = window.__store.getState();
      for (const w of [...s.windows]) s.closeWindow(w.id);
      s.clearChatHistory();
      s.setChatRoom("brief");
    });
    await page.waitForTimeout(200);

    /* --- Step 3: toggle chat mode via dock-chat-mode button --- */
    console.log("[3] toggle into chat mode via FloatingDock MessageSquare");
    await page.click('[data-testid="dock-chat-mode"]');
    await page.waitForSelector('[data-testid="chat-layout"]', {
      timeout: 5000,
    });
    await page.waitForTimeout(500);
    await snap(page, "03-chat-mode-empty");

    /* --- Step 4: submit 5 queries --- */
    for (let i = 0; i < QUERIES.length; i++) {
      const q = QUERIES[i];
      const idx = i + 1;
      console.log(`[4.${idx}] submit: ${q}`);

      const recentActionsBefore = await page.evaluate(
        () => window.__store.getState().recentActions.slice(),
      );

      const inputEl = await page.$('[data-testid="chat-input"]');
      await inputEl.click();
      await inputEl.fill(q);
      // Press Enter to submit
      await page.keyboard.press("Enter");

      const settleResult = await settle(page, SETTLE_MS);

      const history = await getChatHistory(page);
      const room = await getEmbeddedRoom(page);
      const recentActionsAfter = await page.evaluate(
        () => window.__store.getState().recentActions.slice(),
      );
      const newActions = recentActionsAfter.slice(recentActionsBefore.length);

      // Find the agent message corresponding to THIS query (the last agent
      // message after the most recent user message for `q`).
      const userIdx = (() => {
        for (let k = history.length - 1; k >= 0; k--) {
          if (history[k].role === "you" && history[k].text === q) return k;
        }
        return -1;
      })();
      const agentForThis = userIdx >= 0
        ? history.slice(userIdx + 1).find((m) => m.role === "agent")
        : null;
      const reply = agentForThis ? agentForThis.text : "";

      perQuery.push({
        i: idx,
        query: q,
        replyLength: reply.length,
        reply,
        replyStatus: agentForThis?.status,
        embeddedRoomLabel: room.label,
        embeddedRoomKind: room.which,
        toolCallsRecent: newActions,
        historyLength: history.length,
        settleResult,
      });

      await snapPanel(page, `04-${idx}-q-${q.slice(0, 16).replace(/\s+/g, "_")}-panel`);
      await snap(page, `04-${idx}-q-${q.slice(0, 16).replace(/\s+/g, "_")}-full`);
    }

    /* --- Step 5: persistent history check --- */
    console.log("[5] verify persistent history");
    const finalHistory = await getChatHistory(page);
    await snapPanel(page, "05-final-history-panel");
    await snap(page, "05-final-history-full");

    /* --- Step 6: embedded room reactivity --- */
    console.log("[6] embedded-room reactivity");
    const finalRoom = await getEmbeddedRoom(page);

    /* --- Step 7: toggle back to windowed mode --- */
    console.log("[7] toggle back to windowed via chat-toggle-mode");
    const focusedRoomBefore = await page.evaluate(
      () => window.__store.getState().chatRoom,
    );
    await page.click('[data-testid="chat-toggle-mode"]');
    await page.waitForTimeout(800);
    await snap(page, "07-after-windowed-toggle");
    const windowsAfterToggle = await page.evaluate(() => {
      const s = window.__store.getState();
      return {
        uiMode: s.uiMode,
        chatRoom: s.chatRoom,
        windows: s.windows.map((w) => ({
          id: w.id,
          kind: w.kind,
          minimized: w.minimized,
          rect: w.rect,
        })),
      };
    });

    /* --- Step 8: open Brief as a window from windowed, then toggle back --- */
    console.log("[8] open Brief as window then toggle back to chat");
    await page.evaluate(() => {
      window.__store.getState().openWindow("brief");
    });
    await page.waitForTimeout(400);
    // Bring Brief to front (just to be sure it's the topmost)
    await page.evaluate(() => {
      const s = window.__store.getState();
      const brief = s.windows.find((w) => w.kind === "brief" && !w.minimized);
      if (brief) s.bringToFront(brief.id);
    });
    await page.waitForTimeout(200);
    await snap(page, "08a-windowed-brief-open");
    // Toggle back to chat mode via the dock toggle
    await page.click('[data-testid="dock-chat-mode"]');
    await page.waitForSelector('[data-testid="chat-layout"]', { timeout: 5000 });
    await page.waitForTimeout(500);
    await snap(page, "08b-chat-after-toggle-back");
    const briefIsEmbedded = await page.evaluate(() => {
      const s = window.__store.getState();
      const label = document
        .querySelector('[data-testid="embedded-room-label"]')
        ?.textContent?.trim() || "";
      return { chatRoom: s.chatRoom, label };
    });

    /* --- Step 9: edge cases --- */
    console.log("[9a] empty submit (no-op)");
    const histBeforeEmpty = await getChatHistory(page);
    const inputEl = await page.$('[data-testid="chat-input"]');
    await inputEl.click();
    await inputEl.fill("");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const histAfterEmpty = await getChatHistory(page);
    const emptyNoOp = histBeforeEmpty.length === histAfterEmpty.length;

    console.log("[9b] submit while previous in flight");
    await inputEl.click();
    await inputEl.fill("first message");
    await page.keyboard.press("Enter");
    // Don't wait for settle; immediately try to send another
    await page.waitForTimeout(150);
    const sendDisabledMidFlight = await page.evaluate(() => {
      const send = document.querySelector('[data-testid="chat-send"]');
      const ta = document.querySelector('[data-testid="chat-input"]');
      return {
        sendDisabled: send ? send.disabled : null,
        textareaDisabled: ta ? ta.disabled : null,
      };
    });
    // Try to type during busy
    let typedDuringBusy = false;
    try {
      await page.locator('[data-testid="chat-input"]').fill("second message", {
        timeout: 1500,
      });
      typedDuringBusy = true;
    } catch (_e) {
      typedDuringBusy = false;
    }
    await page.keyboard.press("Enter").catch(() => {});
    await settle(page, SETTLE_MS);
    await snapPanel(page, "09-edge-cases-panel");

    /* --- write artifacts --- */
    await writeFile(
      resolve(OUT_DIR, "console-errors.json"),
      JSON.stringify(consoleErrors, null, 2),
    );
    await writeFile(
      resolve(OUT_DIR, "network-failures.json"),
      JSON.stringify(networkFailures, null, 2),
    );
    await writeFile(
      resolve(OUT_DIR, "test-data.json"),
      JSON.stringify(
        {
          finalHistory,
          finalRoom,
          windowsAfterToggle,
          focusedRoomBefore,
          briefIsEmbedded,
          emptyNoOp,
          sendDisabledMidFlight,
          typedDuringBusy,
          perQuery,
        },
        null,
        2,
      ),
    );

    console.log("\n[done]");
    console.log(`  console errors: ${consoleErrors.length}`);
    console.log(`  network failures: ${networkFailures.length}`);
    console.log(`  per-query log entries: ${perQuery.length}`);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
