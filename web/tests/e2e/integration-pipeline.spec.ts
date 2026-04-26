/**
 * E2E integration-pipeline tests.
 *
 * Verifies: frontend -> backend -> SurrealDB round-trip.
 *
 * Prerequisites:
 *   - Backend on :8080  (tests 1-2)
 *   - Frontend on :3000  (tests 3-4)
 *
 * Tests that require a missing server are skipped with a clear message.
 */
import { test, expect, APIRequestContext } from "@playwright/test";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const BACKEND = "http://localhost:8080";
const FRONTEND = "http://localhost:3000";

async function isReachable(
  request: APIRequestContext,
  url: string,
): Promise<boolean> {
  try {
    const r = await request.get(url, { timeout: 3_000 });
    return r.ok();
  } catch {
    return false;
  }
}

/** Dismiss the onboarding overlay if it appears. */
async function dismissOnboarding(page: import("@playwright/test").Page) {
  const skip = page.getByTestId("skip-onboarding");
  // Give it a short window to appear; if it doesn't, move on.
  try {
    await skip.click({ timeout: 5_000 });
    // Wait for the overlay to animate away
    await page.getByTestId("onboarding-overlay").waitFor({
      state: "hidden",
      timeout: 3_000,
    });
  } catch {
    // Overlay didn't appear — that's fine
  }
}

/* ------------------------------------------------------------------ */
/*  Test 1 — Backend API health                                       */
/* ------------------------------------------------------------------ */

test.describe("Backend API health", () => {
  test("GET /api/health returns 200 with status", async ({ request }) => {
    const alive = await isReachable(request, `${BACKEND}/api/health`);
    test.skip(!alive, "Backend is not running on :8080 — skipping");

    const res = await request.get(`${BACKEND}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("surreal");
  });

  test("GET /api/kg/workflows returns a JSON array", async ({ request }) => {
    const alive = await isReachable(request, `${BACKEND}/api/health`);
    test.skip(!alive, "Backend is not running on :8080 — skipping");

    const res = await request.get(`${BACKEND}/api/kg/workflows`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Test 2 — Backend write round-trip via API                         */
/* ------------------------------------------------------------------ */

test.describe("Backend write round-trip", () => {
  const TAG = `e2e-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    const alive = await isReachable(request, `${BACKEND}/api/health`);
    test.skip(!alive, "Backend is not running on :8080 — skipping");
  });

  test("POST + GET memory round-trip", async ({ request }) => {
    const alive = await isReachable(request, `${BACKEND}/api/health`);
    test.skip(!alive, "Backend is not running on :8080 — skipping");

    // POST a test memory
    const postRes = await request.post(`${BACKEND}/api/kg/memories`, {
      data: {
        content: `E2E test memory ${TAG}`,
        memory_type: "fact",
        confidence: 0.9,
        tags: [TAG],
      },
    });
    expect(postRes.status()).toBe(201);

    // GET memories and verify the test memory appears
    const getRes = await request.get(`${BACKEND}/api/kg/memories`);
    expect(getRes.status()).toBe(200);
    const memories: unknown[] = await getRes.json();
    expect(Array.isArray(memories)).toBe(true);
    const found = memories.some(
      (m: any) =>
        typeof m.content === "string" && m.content.includes(`E2E test memory ${TAG}`),
    );
    expect(found).toBe(true);
  });

  test("POST + GET workflow round-trip", async ({ request }) => {
    const alive = await isReachable(request, `${BACKEND}/api/health`);
    test.skip(!alive, "Backend is not running on :8080 — skipping");

    const slug = `e2e_wf_${TAG}`;
    const postRes = await request.post(`${BACKEND}/api/kg/workflows`, {
      data: {
        slug,
        name: `E2E Workflow ${TAG}`,
        description: "Playwright integration test workflow",
        tags: [TAG],
      },
    });
    expect(postRes.status()).toBe(201);
    const postBody = await postRes.json();
    const savedSlug = (postBody as any).slug ?? slug;

    const getRes = await request.get(`${BACKEND}/api/kg/workflows`);
    expect(getRes.status()).toBe(200);
    const workflows: unknown[] = await getRes.json();
    expect(Array.isArray(workflows)).toBe(true);
    const found = workflows.some(
      (w: any) => typeof w.slug === "string" && w.slug === savedSlug,
    );
    expect(found).toBe(true);
  });

  test("POST + GET chat round-trip", async ({ request }) => {
    const alive = await isReachable(request, `${BACKEND}/api/health`);
    test.skip(!alive, "Backend is not running on :8080 — skipping");

    const postRes = await request.post(`${BACKEND}/api/kg/chats`, {
      data: {
        content: `E2E test chat ${TAG}`,
        source_type: "ui_chat",
        title: `E2E Chat ${TAG}`,
        signal_level: "low",
      },
    });
    expect(postRes.status()).toBe(201);

    const getRes = await request.get(
      `${BACKEND}/api/kg/chats?source_type=ui_chat`,
    );
    expect(getRes.status()).toBe(200);
    const chats: unknown[] = await getRes.json();
    expect(Array.isArray(chats)).toBe(true);
    const found = chats.some(
      (c: any) =>
        typeof c.content === "string" && c.content.includes(`E2E test chat ${TAG}`),
    );
    expect(found).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Test 3 — Frontend loads and shows chat UI                         */
/* ------------------------------------------------------------------ */

test.describe("Frontend loads and shows chat UI", () => {
  test("page loads with expected title and dock", async ({
    page,
    request,
  }) => {
    const alive = await isReachable(request, FRONTEND);
    test.skip(!alive, "Frontend is not running on :3000 — skipping");

    await page.goto("/");
    await dismissOnboarding(page);
    await expect(page).toHaveTitle(/microbots/i);

    // The dock bar is always visible on load
    const dock = page.locator('nav[aria-label="agent dock"]');
    await expect(dock).toBeVisible({ timeout: 10_000 });
  });

  test("chat panel appears when chat mode is activated", async ({
    page,
    request,
  }) => {
    const alive = await isReachable(request, FRONTEND);
    test.skip(!alive, "Frontend is not running on :3000 — skipping");

    await page.goto("/");
    await dismissOnboarding(page);

    // Click the chat-mode button in the dock
    const chatBtn = page.getByTestId("dock-chat-mode");
    await expect(chatBtn).toBeVisible({ timeout: 10_000 });
    await chatBtn.click();

    // The chat panel should now be visible
    const chatPanel = page.getByTestId("chat-panel");
    await expect(chatPanel).toBeVisible({ timeout: 10_000 });

    // The chat input should exist
    const chatInput = page.getByTestId("chat-input");
    await expect(chatInput).toBeVisible();
  });
});

/* ------------------------------------------------------------------ */
/*  Test 4 — Chat send flow                                           */
/* ------------------------------------------------------------------ */

test.describe("Chat send flow", () => {
  test("typed message appears in the chat panel", async ({
    page,
    request,
  }) => {
    const alive = await isReachable(request, FRONTEND);
    test.skip(!alive, "Frontend is not running on :3000 — skipping");

    await page.goto("/");
    await dismissOnboarding(page);

    // Activate chat mode
    const chatBtn = page.getByTestId("dock-chat-mode");
    await expect(chatBtn).toBeVisible({ timeout: 10_000 });
    await chatBtn.click();

    const chatInput = page.getByTestId("chat-input");
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // Type and submit a message
    const testMsg = `Playwright test ${Date.now()}`;
    await chatInput.fill(testMsg);
    await chatInput.press("Enter");

    // Verify the user message appears in the message list
    const messageList = page.getByTestId("chat-message-list");
    await expect(messageList).toBeVisible({ timeout: 10_000 });
    await expect(
      messageList.getByText(testMsg, { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
