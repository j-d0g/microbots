/**
 * Verify the three surgical fixes (O8, O7, O4) end-to-end against the
 * running dev server at http://localhost:3001. Forces a backend-down
 * scenario by aborting all requests to the deployed FastAPI host so we
 * deterministically exercise the failure paths regardless of whether
 * the Render service is actually up.
 *
 * Run from web/:
 *   node tests/parallel-runs-2026-04-26/Z-verify-fixes/run.mjs
 */

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "screenshots");

const results = [];
function record(id, name, passed, detail) {
  results.push({ id, name, passed, detail });
  // eslint-disable-next-line no-console
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${id}  ${name}` +
      (detail ? `\n      ${detail}` : ""),
  );
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    consoleErrors.push({ type: msg.type(), text: msg.text() });
  }
});

// Force backend-down: abort everything pointing at the deployed FastAPI
// host. The dev server itself (localhost:3001) is unaffected.
await page.route("**/app-bf31.onrender.com/**", (route) => route.abort());

await page.goto("http://localhost:3001", { waitUntil: "networkidle" });

/* -------- onboarding + user_id -------- */
await page.getByTestId("skip-onboarding").click().catch(async () => {
  await page.getByTestId("onboarding-dot").click();
});
await page
  .getByTestId("settings-user-id-input")
  .fill("verify_fixes_z");
await page.getByTestId("settings-user-id-save").click();
await page.waitForTimeout(500);

/* ===========================================================
 * O8 — SettingsRoom HealthRow: down chip uses tone="low"
 * =========================================================== */
// Trigger a fresh probe so the store reflects backend-down.
await page.evaluate(() => {
  const s = window.__store?.getState?.();
  if (!s) return;
  // Force a probe by calling backend.getHealth via the bridge polling
  // (it auto-fires on mount). Just wait for the first probe to land.
});
// Wait for the first health poll to fail and update the store.
await page.waitForFunction(
  () => {
    const s = window.__store?.getState?.();
    return s?.backendHealth && s.backendHealth.surrealOk === false;
  },
  { timeout: 8000 },
).catch(() => undefined);

await page.screenshot({ path: path.join(SHOTS, "01-settings-with-down.png"), fullPage: true });

const surrealRow = page.getByTestId("settings-health-surrealdb");
const composioRow = page.getByTestId("settings-health-composio");

// Read the chip classes from each row and assert text-confidence-low
// is in the class list (tone="low" → that color class).
const surrealClasses = await surrealRow
  .locator("span")
  .last()
  .getAttribute("class")
  .catch(() => "");
const composioClasses = await composioRow
  .locator("span")
  .last()
  .getAttribute("class")
  .catch(() => "");
const surrealText = (await surrealRow.textContent()) ?? "";
const composioText = (await composioRow.textContent()) ?? "";

const o8Passed =
  surrealText.includes("down") &&
  composioText.includes("down") &&
  surrealClasses?.includes("text-confidence-low") === true &&
  composioClasses?.includes("text-confidence-low") === true;

record(
  "O8",
  "SettingsRoom down chip uses tone=low (rust)",
  o8Passed,
  `surreal text="${surrealText.trim()}" classes=${(surrealClasses ?? "").includes("text-confidence-low")}; composio text="${composioText.trim()}" classes=${(composioClasses ?? "").includes("text-confidence-low")}`,
);

/* ===========================================================
 * O7 — GraphRoom: all-rejected ⇒ retry overlay visible
 * =========================================================== */
// Open graph as a window via the store (windowed mode; graph is in the
// allow-set so this is legal).
await page.evaluate(() => {
  const s = window.__store?.getState?.();
  s.openWindow("graph");
});
await page.waitForTimeout(2500); // give the 7 fetches time to fail

await page.screenshot({ path: path.join(SHOTS, "02-graph-room-backend-down.png"), fullPage: true });

// The fix means with backend down, loadError is set → red overlay +
// retry button render. The pre-fix behaviour was the friendly "empty
// graph — connect a tool…" text.
const graphLoadFailedVisible = await page
  .getByText("graph load failed", { exact: false })
  .first()
  .isVisible()
  .catch(() => false);
const retryVisible = await page
  .getByRole("button", { name: /retry/i })
  .first()
  .isVisible()
  .catch(() => false);
const oldEmptyVisible = await page
  .getByText("empty graph", { exact: false })
  .first()
  .isVisible()
  .catch(() => false);

const o7Passed = graphLoadFailedVisible && retryVisible && !oldEmptyVisible;

record(
  "O7",
  "GraphRoom: all-rejected fetches surface retry overlay",
  o7Passed,
  `load-failed=${graphLoadFailedVisible} retry-button=${retryVisible} stale-empty-state=${oldEmptyVisible}`,
);

/* ===========================================================
 * O4 — Multiple integration windows fan-out (no rect collision)
 * =========================================================== */
// Programmatically open three integration windows. The fix applies
// jitter in the defaultMount path so each ends up at a distinct rect.
const rects = await page.evaluate(() => {
  const s = window.__store?.getState?.();
  // Close any existing integration windows first (clean slate).
  const existing = s.windows
    .filter((w) => w.kind === "integration")
    .map((w) => w.id);
  existing.forEach((id) => s.closeWindow(id));
  const next = window.__store.getState();
  next.openWindow("integration", { payload: { slug: "slack" } });
  next.openWindow("integration", { payload: { slug: "github" } });
  next.openWindow("integration", { payload: { slug: "gmail" } });
  return window.__store
    .getState()
    .windows.filter((w) => w.kind === "integration")
    .map((w) => ({ id: w.id, slug: w.payload?.slug, rect: w.rect }));
});

await page.screenshot({ path: path.join(SHOTS, "03-three-integrations.png"), fullPage: true });

// All distinct? Compare each pair's (x,y) — fix passes if no two share
// both coordinates.
const distinctXY = new Set(rects.map((r) => `${r.rect.x},${r.rect.y}`));
const o4Passed = rects.length === 3 && distinctXY.size === 3;

record(
  "O4",
  "defaultMount-resolved windows fan out (3 integrations at 3 distinct rects)",
  o4Passed,
  `count=${rects.length} unique-positions=${distinctXY.size} rects=${JSON.stringify(rects.map((r) => `${r.slug}@(${r.rect.x},${r.rect.y})`))}`,
);

/* ===========================================================
 * O1 — Stale agentReply is cleared on new turn (windowed)
 *      and tools-only turn doesn't leave empty chat bubble (chat)
 * =========================================================== */

// Reset to a clean slate. Close any extra windows.
await page.evaluate(() => {
  const s = window.__store.getState();
  s.windows.forEach((w) => s.closeWindow(w.id));
});

// Inject stale agentReply state simulating a prior turn.
const STALE = "STALE_REPLY_FROM_PRIOR_TURN_xyz123";
await page.evaluate((stale) => {
  const s = window.__store.getState();
  s.startReply("PRIOR_QUERY");
  s.appendReply(stale);
}, STALE);

const beforeReply = await page.evaluate(
  () => window.__store.getState().agentReply,
);

// Submit a fresh query via the spotlight (`/` keybinding).
await page.keyboard.press("/");
await page
  .waitForFunction(
    () => !!document.querySelector("input[placeholder*='ask']"),
    { timeout: 3000 },
  )
  .catch(() => undefined);
const spotlightInput = page.locator("input[placeholder*='ask']");
await spotlightInput.fill("show me the graph");
await page.keyboard.press("Enter");

// Wait until the orchestrator settles (dock back to idle) AND
// agentReply is no longer the stale text.
await page
  .waitForFunction(
    (stale) => {
      const s = window.__store?.getState?.();
      return s?.dock === "idle" && s.agentReply !== stale;
    },
    STALE,
    { timeout: 25000 },
  )
  .catch(() => undefined);

await page.screenshot({
  path: path.join(SHOTS, "04-after-fresh-query.png"),
  fullPage: true,
});

const afterReply = await page.evaluate(
  () => window.__store.getState().agentReply,
);

const o1WindowedPassed = afterReply !== STALE && beforeReply === STALE;
record(
  "O1.windowed",
  "agentReply cleared between turns (no stale dock text)",
  o1WindowedPassed,
  `before-injected="${beforeReply.slice(0, 30)}" after-query="${afterReply.slice(0, 50)}"`,
);

// Now toggle into chat mode and verify a tools-only turn doesn't leave
// an empty agent bubble in the chat history. We can't deterministically
// force the LLM to pick tools-only, but we CAN check that the previous
// behaviour (empty bubble on reply.start before any chunk) is no longer
// happening — by injecting just a reply.start event and asserting no
// chatMessage was created.
await page.evaluate(() => {
  const s = window.__store.getState();
  s.setUiMode("chat");
});
await page.waitForTimeout(300);

const chatBefore = await page.evaluate(
  () => window.__store.getState().chatMessages.length,
);

// Manually invoke the SSE-level reply.start handler via the store —
// equivalent to what the orchestrate route emits before any tool runs.
// The fix means this should NOT push an empty agent message.
await page.evaluate(() => {
  const s = window.__store.getState();
  s.startReply("synthetic_no_chunks_query");
});

const chatAfterStart = await page.evaluate(
  () => window.__store.getState().chatMessages.length,
);

const o1ChatPassed = chatAfterStart === chatBefore;
record(
  "O1.chat",
  "tools-only turn does not push an empty agent bubble",
  o1ChatPassed,
  `chatMessages-before-start=${chatBefore} after-start=${chatAfterStart} (should be equal)`,
);

/* -------- write summary + cleanup -------- */
await writeFile(
  path.join(HERE, "results.json"),
  JSON.stringify(
    { results, consoleErrors, rects, o1: { beforeReply, afterReply, chatBefore, chatAfterStart } },
    null,
    2,
  ),
);

await browser.close();

const allPassed = results.every((r) => r.passed);
// eslint-disable-next-line no-console
console.log(`\n${allPassed ? "ALL PASSED" : "SOME FAILED"}: ${results.filter((r) => r.passed).length}/${results.length}`);
process.exit(allPassed ? 0 : 1);
