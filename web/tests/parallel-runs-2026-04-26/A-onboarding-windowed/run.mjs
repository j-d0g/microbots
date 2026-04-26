/**
 * E2E parallel-run A — first-run user → onboarding → user_id → windowed agent.
 *
 * Prereqs:
 *  - dev server running on http://localhost:3001
 *  - OPENROUTER_API_KEY set so /api/agent/orchestrate is live
 *
 * Run from web/:
 *   node tests/parallel-runs-2026-04-26/A-onboarding-windowed/run.mjs
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const SHOTS = resolve(OUT, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const URL = "http://localhost:3001";
const QUERIES = [
  "morning brief",
  "show me the graph",
  "open the bug triage workflow",
  "list services",
  "what's broken in my stack",
];

const consoleErrors = [];
const networkFailures = [];
const queryLog = [];
const notes = []; // free-form chronological log

function log(...args) {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  console.log(line);
  notes.push(line);
}

async function shot(page, name) {
  const file = resolve(SHOTS, `${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
    log(`screenshot ${name}.png`);
  } catch (err) {
    log(`screenshot ${name}.png FAILED:`, err.message);
  }
}

async function dockState(page) {
  return page.evaluate(() => {
    // The store is exposed by StoreBridge as window.__store.
    // @ts-ignore
    const store = window.__store?.getState?.();
    return store?.dock ?? null;
  });
}

async function getStoreSummary(page) {
  return page.evaluate(() => {
    // @ts-ignore
    const s = window.__store?.getState?.();
    if (!s) return { available: false };
    return {
      available: true,
      dock: s.dock,
      lastQuery: s.lastQuery,
      uiMode: s.uiMode,
      onboarded: s.onboarded,
      userId: s.userId,
      windows: (s.windows ?? []).map((w) => ({
        id: w.id,
        kind: w.kind,
        slug: w.slug ?? null,
        minimized: w.minimized,
        rect: w.rect,
        zIndex: w.zIndex,
      })),
      cards: (s.cards ?? []).map((c) => ({ id: c.id, kind: c.kind, data: c.data })),
      recentActions: (s.recentActions ?? []).map((a) => ({
        tool: a.tool,
        args: a.args,
        ok: a.ok,
        t: a.t,
      })),
      agentReply: s.agentReply,
    };
  });
}

async function waitForDockIdle(page, ms = 8000) {
  // First, wait for the dock to LEAVE idle (proving the query started).
  // If it never leaves idle within ~1500ms, give up and report.
  const start = Date.now();
  let saw = null;
  while (Date.now() - start < 1500) {
    const d = await dockState(page);
    if (d && d !== "idle") {
      saw = d;
      break;
    }
    await page.waitForTimeout(80);
  }
  if (!saw) {
    return { left: false, end: await dockState(page), elapsed: Date.now() - start };
  }
  // Then wait for it to come back to idle (or timeout).
  while (Date.now() - start < ms) {
    const d = await dockState(page);
    if (d === "idle" || d === "hidden") {
      return { left: true, end: d, elapsed: Date.now() - start };
    }
    await page.waitForTimeout(150);
  }
  return { left: true, end: await dockState(page), elapsed: Date.now() - start };
}

async function openSpotlight(page) {
  // First ensure no input is focused (so / isn't typed into a field).
  await page.evaluate(() => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) {
      ae.blur();
    }
  });
  // Press `/` on the body to open the spotlight.
  await page.keyboard.press("/");
  // The CommandBar input is autofocused; wait for it to appear.
  await page.waitForSelector('input[placeholder="ask the agent…"]', {
    timeout: 3000,
  });
}

async function submitQueryViaSpotlight(page, query) {
  await openSpotlight(page);
  const input = page.locator('input[placeholder="ask the agent…"]');
  await input.fill(query);
  // Ensure the input is focused before pressing Enter.
  await input.focus();
  await page.keyboard.press("Enter");
}

(async () => {
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
        location: msg.location?.() ?? null,
        ts: Date.now(),
      });
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push({
      type: "pageerror",
      text: err.message,
      stack: err.stack,
      ts: Date.now(),
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

  // Capture orchestrate request bodies + response status so we can
  // distinguish "agent didn't run" from "agent ran but didn't open
  // anything".
  const orchestrateLog = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/agent/orchestrate")) {
      try {
        const body = req.postData();
        orchestrateLog.push({
          phase: "request",
          ts: Date.now(),
          body: body ? JSON.parse(body) : null,
        });
      } catch {
        orchestrateLog.push({ phase: "request", ts: Date.now(), body: null });
      }
    }
  });
  page.on("response", async (res) => {
    if (res.url().endsWith("/api/agent/orchestrate")) {
      orchestrateLog.push({
        phase: "response",
        ts: Date.now(),
        status: res.status(),
        headers: res.headers(),
      });
    }
  });

  try {
    // ------------------------------------------------------------------
    // 1. Land on the home page (fresh user — onboarded should be false)
    // ------------------------------------------------------------------
    log("step 1 — goto", URL);
    await page.goto(URL, { waitUntil: "networkidle" });
    // Clear any stored onboarded flag from a previous run so this is
    // truly a "first-run" flow.
    await page.evaluate(() => {
      try {
        // The settings room persists user_id under `microbots:userId`.
        // The store itself doesn't persist `onboarded`, so a hard
        // reload always starts in onboarding.
        localStorage.removeItem("microbots:userId");
      } catch {}
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await shot(page, "01-landing-fresh");

    // Check whether the OnboardingRoom is present.
    const onboardingDot = page.locator('[data-testid="onboarding-dot"]');
    const skipLink = page.locator('[data-testid="skip-onboarding"]');
    const dotVisible = await onboardingDot.isVisible().catch(() => false);
    log("onboarding dot visible:", dotVisible);

    // ------------------------------------------------------------------
    // 2. Onboarding → click skip-to-settings (more deterministic)
    // ------------------------------------------------------------------
    if (dotVisible) {
      log("step 2 — clicking onboarding-dot");
      await onboardingDot.click({ timeout: 2000 });
      await page.waitForTimeout(600);
    } else if (await skipLink.isVisible().catch(() => false)) {
      log("step 2 — clicking skip-onboarding (dot not visible)");
      await skipLink.click();
      await page.waitForTimeout(600);
    } else {
      log("step 2 — onboarding ROOM NOT FOUND, may already be onboarded");
    }
    await shot(page, "02-after-onboarding");

    // ------------------------------------------------------------------
    // 3. Settings room: fill user_id → save → expect saved chip + toast
    // ------------------------------------------------------------------
    log("step 3 — settings room user_id");
    const settingsSection = page.locator(
      '[data-testid="settings-section-user-id"]',
    );
    await settingsSection.waitFor({ state: "visible", timeout: 5000 });
    const input = page.locator('[data-testid="settings-user-id-input"]');
    await input.click();
    await input.fill("test_e2e_a");
    await shot(page, "03-userid-typed");

    const saveBtn = page.locator('[data-testid="settings-user-id-save"]');
    await saveBtn.click();
    await page.waitForTimeout(800);

    const summaryAfterSave = await getStoreSummary(page);
    log("after save store:", {
      userId: summaryAfterSave.userId,
      onboarded: summaryAfterSave.onboarded,
      cards: summaryAfterSave.cards?.map((c) => c.kind),
    });
    await shot(page, "04-userid-saved");

    // Check the saved chip text is now visible.
    const savedChipVisible = await page
      .getByText(/^saved$/i)
      .first()
      .isVisible()
      .catch(() => false);
    log("saved chip visible:", savedChipVisible);

    // ------------------------------------------------------------------
    // 4. Press `/` to open spotlight, run queries one at a time.
    //    Capture before/after screenshots + store snapshots.
    // ------------------------------------------------------------------
    // First close the settings window so the canvas is clean (or leave it;
    // the spec doesn't say to close it). We'll leave it open so the agent
    // sees an existing window in the snapshot.

    for (let i = 0; i < QUERIES.length; i++) {
      const q = QUERIES[i];
      const qIdx = String(i + 1).padStart(2, "0");
      const safeName = q.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
      log(`\n--- query ${qIdx}: ${q} ---`);
      const before = await getStoreSummary(page);
      await shot(page, `q${qIdx}-${safeName}-before`);
      const t0 = Date.now();
      await submitQueryViaSpotlight(page, q);
      // Wait for agent to settle (dock idle/hidden) — up to 8s post-submit.
      const settle = await waitForDockIdle(page, 8000);
      const elapsed = Date.now() - t0;
      // small extra wait for any post-stream UI animations + spotlight
      // auto-dismiss in windowed mode (350ms timer, see CommandBar.tsx).
      await page.waitForTimeout(900);
      const after = await getStoreSummary(page);
      // Deduce what changed.
      const beforeKinds = (before.windows ?? []).map((w) => `${w.kind}${w.slug ? `:${w.slug}` : ""}`);
      const afterKinds = (after.windows ?? []).map((w) => `${w.kind}${w.slug ? `:${w.slug}` : ""}`);
      const opened = afterKinds.filter((k) => !beforeKinds.includes(k));
      const closed = beforeKinds.filter((k) => !afterKinds.includes(k));
      const newCards = (after.cards ?? []).filter(
        (c) => !(before.cards ?? []).some((b) => b.id === c.id),
      );
      const newActions = (after.recentActions ?? []).filter(
        (a) => !(before.recentActions ?? []).some((b) => b.t === a.t && b.tool === a.tool),
      );
      log("settle:", settle);
      log("opened:", opened, "closed:", closed, "newCards:", newCards.map((c) => c.kind));
      log("recentActions added:", newActions.map((a) => a.tool));
      log("elapsedMs:", elapsed);
      log("agentReply:", (after.agentReply ?? "").slice(0, 200));
      await shot(page, `q${qIdx}-${safeName}-after`);
      queryLog.push({
        query: q,
        elapsedMs: elapsed,
        settle,
        opened,
        closed,
        newCards: newCards.map((c) => ({ kind: c.kind, data: c.data })),
        newActions: newActions.map((a) => ({ tool: a.tool, args: a.args, ok: a.ok })),
        agentReply: (after.agentReply ?? "").slice(0, 400),
      });
      // Don't press Escape — that kills any still-in-flight streams.
      // The spotlight auto-dismisses after 350ms in windowed mode.
      await page.waitForTimeout(400);
    }

    // ------------------------------------------------------------------
    // 5. Try a SnapshotInspector capture mid-query
    // ------------------------------------------------------------------
    log("\nstep 5 — toggle SnapshotInspector via Cmd+Shift+S");
    // Open inspector first (so it's visible while we fire next query).
    await page.keyboard.press("Meta+Shift+S").catch(() => {});
    await page.waitForTimeout(400);
    // If still not open (different platform), try Control+Shift+S.
    await page.keyboard.press("Control+Shift+S").catch(() => {});
    await page.waitForTimeout(400);
    // Submit a query so the inspector shows in-flight state.
    await submitQueryViaSpotlight(page, "give me a vibe check on the stack");
    // Capture mid-flight after a small delay.
    await page.waitForTimeout(1500);
    await shot(page, "05-snapshot-inspector-midflight");
    await waitForDockIdle(page, 8000);
    await page.waitForTimeout(400);
    await shot(page, "06-snapshot-inspector-settled");
    // Toggle off.
    await page.keyboard.press("Meta+Shift+S").catch(() => {});
    await page.waitForTimeout(200);
    await page.keyboard.press("Control+Shift+S").catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);

    // ------------------------------------------------------------------
    // 6. Try ONE direct dock interaction — click a room icon.
    //    (FloatingDock comment says "No room icons — those were removed
    //    for the windowed setting" — verify whether anything is clickable.)
    // ------------------------------------------------------------------
    log("\nstep 6 — direct dock interaction probe");
    // Inventory dock buttons.
    const dockButtons = await page
      .locator('nav[aria-label="agent dock"] button')
      .evaluateAll((els) =>
        els.map((b) => ({
          ariaLabel: b.getAttribute("aria-label"),
          testid: b.getAttribute("data-testid"),
          text: (b.textContent || "").trim().slice(0, 40),
          rect: b.getBoundingClientRect ? (() => {
            const r = b.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          })() : null,
        })),
      )
      .catch(() => []);
    log("dock buttons inventory:", dockButtons);
    // The dock here only has the chat-mode toggle; there are no room
    // icons. Note this in the report. Do not click chat-mode (that
    // would switch us out of windowed mode).
    await shot(page, "07-dock-inventory");

    // ------------------------------------------------------------------
    // 7. Drag an opened window by its title bar by ~100px.
    // ------------------------------------------------------------------
    log("\nstep 7 — drag a window by its title bar");
    // Look for any open window. Settings was opened by onboarding;
    // graph may have been opened by 'show me the graph'.
    const beforeDrag = await getStoreSummary(page);
    const winSummaries = beforeDrag.windows ?? [];
    log("windows before drag:", winSummaries.map((w) => `${w.kind} ${JSON.stringify(w.rect)}`));
    let targetKind = null;
    if (winSummaries.length > 0) {
      // Prefer the topmost (highest zIndex) non-minimized window.
      const top = [...winSummaries]
        .filter((w) => !w.minimized)
        .sort((a, b) => b.zIndex - a.zIndex)[0];
      if (top) targetKind = top.kind;
    }
    log("drag target kind:", targetKind);
    if (targetKind) {
      // Use the topmost (highest zIndex) window of this kind. Among
      // 6 stacked integrations, querying [data-testid="window-X"].first()
      // gives DOM order, NOT z-order — pick the highest-zIndex one.
      const top = [...winSummaries]
        .filter((w) => w.kind === targetKind && !w.minimized)
        .sort((a, b) => b.zIndex - a.zIndex)[0];
      log("targeting topmost window id:", top?.id, "rect:", top?.rect);
      // Use a CSS selector that picks the right z-stacked window if we can.
      // Without per-window data-window-id selector preference, fall back
      // to the first match and just verify SOMETHING moved.
      const win = page.locator(`[data-window-id="${top.id}"]`);
      const winBox = await win.boundingBox().catch(() => null);
      if (winBox) {
        // The title bar is the first 32px of the window.
        const startX = winBox.x + winBox.width / 2;
        const startY = winBox.y + 16; // mid-titlebar
        const endX = startX + 100;
        const endY = startY + 50;
        log("dragging from", { startX, startY }, "to", { endX, endY });
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        // Move in steps so onmousemove fires.
        for (let s = 1; s <= 12; s++) {
          await page.mouse.move(
            startX + ((endX - startX) * s) / 12,
            startY + ((endY - startY) * s) / 12,
          );
          await page.waitForTimeout(15);
        }
        await page.mouse.up();
        await page.waitForTimeout(600);
        const afterDrag = await getStoreSummary(page);
        // Compute per-window delta — find the one that actually moved.
        const movedWindows = afterDrag.windows
          .map((aw) => {
            const before = beforeDrag.windows.find((bw) => bw.id === aw.id);
            const dx = before ? aw.rect.x - before.rect.x : 0;
            const dy = before ? aw.rect.y - before.rect.y : 0;
            return { id: aw.id, kind: aw.kind, dx, dy, rect: aw.rect };
          })
          .filter((w) => w.dx !== 0 || w.dy !== 0);
        log("windows that moved:", movedWindows);
        // also note the focused-after window
        const focusedAfter = [...afterDrag.windows]
          .filter((w) => !w.minimized)
          .sort((a, b) => b.zIndex - a.zIndex)[0];
        log("topmost after drag:", focusedAfter ? { id: focusedAfter.id, kind: focusedAfter.kind, rect: focusedAfter.rect } : null);
        await shot(page, "08-after-drag");
      } else {
        log("could not get window bounding box for", top.id);
      }
    } else {
      log("no window to drag");
    }

    // ------------------------------------------------------------------
    // Final state shot.
    // ------------------------------------------------------------------
    await shot(page, "09-final");
  } catch (err) {
    log("FATAL:", err?.stack ?? err?.message ?? String(err));
  } finally {
    // Persist all telemetry.
    writeFileSync(
      resolve(OUT, "console-errors.json"),
      JSON.stringify(consoleErrors, null, 2),
    );
    writeFileSync(
      resolve(OUT, "network-failures.json"),
      JSON.stringify(networkFailures, null, 2),
    );
    writeFileSync(
      resolve(OUT, "query-log.json"),
      JSON.stringify(queryLog, null, 2),
    );
    writeFileSync(
      resolve(OUT, "orchestrate-log.json"),
      JSON.stringify(orchestrateLog, null, 2),
    );
    writeFileSync(resolve(OUT, "run.log"), notes.join("\n"));
    await browser.close();
    log(
      `done. console-errors=${consoleErrors.length} network-failures=${networkFailures.length} queries=${queryLog.length}`,
    );
  }
})();
