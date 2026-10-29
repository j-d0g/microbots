import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3100/api/state",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
