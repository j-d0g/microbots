import { expect, test } from "@playwright/test";

test("placeholder page displays snapshot counts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
  await expect(page.locator("main")).toContainText(/\d+ agents · \d+ tasks · \d+ feed events/);
});
