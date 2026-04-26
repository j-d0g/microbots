import { test, expect } from "@playwright/test";

test("v0 smoke — agent computes square of 7 via run_code", async ({ page }) => {
  await page.goto("/");

  // Page loads with the chat shell visible.
  await expect(page.getByRole("heading", { name: /microbot harness/i })).toBeVisible();
  await expect(page.getByTestId("chat-input")).toBeVisible();

  // User submits a prompt.
  await page.getByTestId("chat-input").fill("compute the square of 7. just give me the number.");
  await page.getByTestId("chat-submit").click();

  // The agent must call run_code at least once. Wait up to 30s.
  const toolInvocation = page.getByTestId("tool-invocation").filter({ hasText: "run_code" });
  await expect(toolInvocation.first()).toBeVisible({ timeout: 90_000 });

  // The final assistant message must contain "49" (the answer).
  const assistantText = page.locator('[data-role="assistant"] [data-testid="message-text"]');
  await expect(assistantText.last()).toContainText("49", { timeout: 90_000 });

  // No chat error rendered.
  await expect(page.getByTestId("chat-error")).toHaveCount(0);
});
