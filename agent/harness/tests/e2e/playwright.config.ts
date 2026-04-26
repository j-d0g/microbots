import { defineConfig, devices } from "@playwright/test";

/**
 * Deterministic e2e for the V1 builder flow (Agent C in 01-implementation.md).
 *
 * Default target is a locally-running stack (FE on :3010 → MCP on :8766)
 * because the V1 tools live on this worktree's branch (jordan/p2-v1-tools)
 * and the deployed Render frontend tracks jordan/microbot_harness_v0,
 * which only exposes the four v0 tools. Once the V1 branch is deployed,
 * point the test at it via:
 *
 *   BASE_URL=https://microbot-harness-frontend.onrender.com npm test
 *
 * Per-test timeout is generous: each turn can incur a Workflows cold
 * start (~5-10s) on top of LLM tokens, and the V1 flow chains 5 turns.
 */
export default defineConfig({
  testDir: "./playwright",
  timeout: 600_000, // 10 min — multi-turn flow with cold starts.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3010",
    trace: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
