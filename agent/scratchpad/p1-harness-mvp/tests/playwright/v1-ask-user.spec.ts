import { test, expect } from "@playwright/test";

test("v1 ask_user — agent asks before destructive action, user answers, agent continues", async ({ page }) => {
  await page.goto("/");

  await page
    .getByTestId("chat-input")
    .fill(
      'I want to delete all the files in /tmp. before doing anything else, you MUST use ask_user to confirm with me. give the question text and a yes/no options array.',
    );
  await page.getByTestId("chat-submit").click();

  // The ask_user prompt UI must appear.
  const prompt = page.getByTestId("ask-user-prompt");
  await expect(prompt.first()).toBeVisible({ timeout: 30_000 });

  // User clicks "no" (or types the answer if no options were provided).
  const noButton = prompt.first().getByTestId("ask-user-option").filter({ hasText: /^no$/i });
  if (await noButton.count()) {
    await noButton.first().click();
  } else {
    await prompt.first().getByTestId("ask-user-input").fill("no");
    await prompt.first().getByTestId("ask-user-submit").click();
  }

  // The agent must continue and produce a final response acknowledging the answer.
  const assistantText = page.locator('[data-role="assistant"] [data-testid="message-text"]');
  await expect(assistantText.last()).toBeVisible({ timeout: 30_000 });
  await expect(assistantText.last()).toContainText(/no|cancel|abort|won'?t|will not|skip/i, { timeout: 30_000 });

  await expect(page.getByTestId("chat-error")).toHaveCount(0);
});
