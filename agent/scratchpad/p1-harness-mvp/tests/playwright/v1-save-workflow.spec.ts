import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

const SAVED_DIR = path.resolve(
  __dirname,
  "../../../../harness/frontend/saved",
);

test("v1 save_workflow — agent writes file and returns URL", async ({ page }) => {
  // Clean any prior copy so we know this run wrote it.
  const target = path.join(SAVED_DIR, "test-ping.py");
  await fs.rm(target, { force: true });

  await page.goto("/");
  await page
    .getByTestId("chat-input")
    .fill('save a workflow called "test-ping" that just prints "pong". do not run it. confirm with the URL.');
  await page.getByTestId("chat-submit").click();

  // Agent must invoke save_workflow.
  const saveCall = page.getByTestId("tool-invocation").filter({ hasText: "save_workflow" });
  await expect(saveCall.first()).toBeVisible({ timeout: 30_000 });

  // Wait for the call to resolve (state becomes "result"), then check final text.
  await expect(saveCall.first()).toHaveAttribute("data-tool-state", "result", { timeout: 30_000 });

  const assistantText = page.locator('[data-role="assistant"] [data-testid="message-text"]');
  await expect(assistantText.last()).toContainText(/example\.com\/workflows\/test-ping/i, { timeout: 30_000 });

  // File must actually exist on disk with the expected content.
  const contents = await fs.readFile(target, "utf-8");
  expect(contents).toMatch(/pong/);

  await expect(page.getByTestId("chat-error")).toHaveCount(0);
});
