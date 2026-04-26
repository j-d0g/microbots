import { test, expect } from "@playwright/test";

test("v1 multistep — agent makes 2+ run_code calls in one turn", async ({ page }) => {
  await page.goto("/");

  await page
    .getByTestId("chat-input")
    .fill(
      "compute the first 5 prime numbers, then sum them. use run_code for each step separately so I can see the work. tell me the final sum.",
    );
  await page.getByTestId("chat-submit").click();

  // At least 2 run_code invocations must complete (state="result").
  const completedRunCode = page
    .getByTestId("tool-invocation")
    .filter({ hasText: "run_code" })
    .filter({ has: page.locator('[data-tool-state="result"]') });
  // Accept either the filter form OR raw count of finished tools.
  await expect(async () => {
    const count = await page.locator('[data-tool-name="run_code"][data-tool-state="result"]').count();
    expect(count).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 45_000 });

  // First 5 primes: 2,3,5,7,11. Sum = 28.
  const assistantText = page.locator('[data-role="assistant"] [data-testid="message-text"]');
  await expect(assistantText.last()).toContainText("28", { timeout: 45_000 });

  await expect(page.getByTestId("chat-error")).toHaveCount(0);
});
