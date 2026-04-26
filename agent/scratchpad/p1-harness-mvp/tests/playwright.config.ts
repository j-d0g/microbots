import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  // Generous per-test budget — Workflows cold start can add 5-10s on top of LLM time.
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
