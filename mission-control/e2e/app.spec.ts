import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const screenshotDir = join(process.env.HOME ?? "/home/ubuntu", "mc-shots");

test("dashboard loads, shows the seeded team, and accepts a shepherd request", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await mkdir(screenshotDir, { recursive: true });
  const reset = await page.request.post("/api/reset");
  expect(reset.ok()).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("MISSION CONTROL", { exact: true })).toBeVisible();
  await expect(page.locator("header")).toContainText(/LINK/, { timeout: 15_000 });
  await page.screenshot({ path: join(screenshotDir, "mission-control-default.png"), fullPage: true });

  await page.getByRole("button", { name: /Agents/ }).click();
  for (const name of ["Shepherd", "Scout", "Scribe", "Ops"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await page.screenshot({ path: join(screenshotDir, "mission-control-agents.png"), fullPage: true });

  await page.getByRole("button", { name: /Tasks/ }).click();
  const input = page.getByPlaceholder(/Talk to the shepherd/);
  await input.fill("research the Pi agent harness");
  await input.press("Enter");
  await expect(page.getByText(/handed that to the right specialist/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Research the Pi agent harness", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: join(screenshotDir, "mission-control-tasks.png"), fullPage: true });

  expect(consoleErrors).toEqual([]);
});
