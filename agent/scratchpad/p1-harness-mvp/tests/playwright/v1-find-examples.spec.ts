import { test, expect } from "@playwright/test";

test("v1 find_examples — agent searches templates for slack send", async ({ page }) => {
  await page.goto("/");

  await page
    .getByTestId("chat-input")
    .fill("do you have any templates for sending a slack message? use find_examples first.");
  await page.getByTestId("chat-submit").click();

  // Agent must invoke find_examples.
  const findExamples = page.getByTestId("tool-invocation").filter({ hasText: "find_examples" });
  await expect(findExamples.first()).toBeVisible({ timeout: 90_000 });

  // Final assistant text mentions the slack template (by id, title, or "slack").
  const assistantText = page.locator('[data-role="assistant"] [data-testid="message-text"]');
  await expect(assistantText.last()).toContainText(/slack/i, { timeout: 90_000 });

  await expect(page.getByTestId("chat-error")).toHaveCount(0);
});
