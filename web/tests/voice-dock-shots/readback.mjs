/**
 * Auto read-back guard test.
 *
 * Simulates the agent finishing a reply (dock speaking → idle) and
 * verifies that VoiceBridge:
 *  - kicks off TTS once
 *  - does NOT re-trigger when its own onEnd flips speaking → idle
 *    again (the previous infinite-loop bug)
 *  - DOES kick off again when a NEW query starts and produces a reply
 */

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../screenshots/voice-dock");
const APP_URL = process.env.APP_URL || "http://localhost:3000/";

const HIDE = `
  [aria-label*="agent snapshot"], [aria-label*="snapshot inspector"] { display: none !important; }
`;

async function setup(page) {
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
  // Stub speechSynthesis so we observe how many times the read-back
  // pipeline kicks off without depending on the headless browser
  // actually playing audio.
  await page.evaluate(() => {
    const w = window;
    w.__speakCount = 0;
    const fakeSyn = {
      speaking: false,
      paused: false,
      pending: false,
      cancel() {},
      pause() {},
      resume() {},
      getVoices() { return []; },
      speak(utterance) {
        w.__speakCount = (w.__speakCount || 0) + 1;
        // Fire onstart synchronously then onend on the next tick so
        // the dock transition (speaking → idle) is observable.
        Promise.resolve().then(() => {
          try { utterance.onstart && utterance.onstart(new Event("start")); } catch {}
          setTimeout(() => {
            try { utterance.onend && utterance.onend(new Event("end")); } catch {}
          }, 80);
        });
      },
    };
    Object.defineProperty(w, "speechSynthesis", { value: fakeSyn, configurable: true });
    w.SpeechSynthesisUtterance = function(text) {
      this.text = text;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    };
  });
  await page.waitForFunction(() => Boolean((window).__voice), { timeout: 5000 });
}

async function speakCount(page) {
  return page.evaluate(() => (window).__speakCount || 0);
}

async function fakeAgentTurn(page, query, reply) {
  await page.evaluate(
    ({ q, r }) => {
      const s = (window).__store.getState();
      // Simulate the orchestrate stream:
      //   reply.start  → store query, clear reply
      //   dock=speaking → streaming
      //   chunks land  → appendReply
      //   reply.done   → dock back to idle
      s.startReply(q);
      s.setDock("speaking");
      s.appendReply(r);
      // VoiceBridge's subscriber listens for the speaking→idle edge.
      s.setDock("idle");
    },
    { q: query, r: reply },
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const failures = [];

  try {
    await setup(page);

    // ---- 1. First turn: must speak exactly once ----
    await fakeAgentTurn(
      page,
      "morning",
      "morning. you have six proposals queued.",
    );
    // wait long enough that the loop bug, if present, would re-trigger
    // many times: ~80ms per fake utterance × 5 ticks
    await page.waitForTimeout(700);
    const c1 = await speakCount(page);
    if (c1 !== 1) {
      failures.push(`expected speak count 1 after first turn, got ${c1}`);
    }
    await page.screenshot({ path: `${OUT_DIR}/readback-01-first-turn.png` });

    // ---- 2. No new turn: count must stay at 1 (loop guard) ----
    await page.waitForTimeout(800);
    const c2 = await speakCount(page);
    if (c2 !== 1) {
      failures.push(
        `loop guard failed — speak count grew to ${c2} without a new turn`,
      );
    }

    // ---- 3. New query → new reply: must speak again ----
    await fakeAgentTurn(
      page,
      "show me the bug triage workflow",
      "here is the bug triage pipeline, top to bottom.",
    );
    await page.waitForTimeout(700);
    const c3 = await speakCount(page);
    if (c3 !== 2) {
      failures.push(`expected speak count 2 after second turn, got ${c3}`);
    }
    await page.screenshot({ path: `${OUT_DIR}/readback-02-second-turn.png` });

    // ---- 4. Same query again → no re-speak ----
    await fakeAgentTurn(
      page,
      "show me the bug triage workflow",
      "here is the bug triage pipeline, top to bottom.",
    );
    await page.waitForTimeout(700);
    const c4 = await speakCount(page);
    if (c4 !== 2) {
      failures.push(
        `same-query guard failed — speak count grew to ${c4}`,
      );
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  if (failures.length) {
    console.error("\nFAIL:");
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
  console.log("PASS: read-back fires once per agent turn, never loops.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
