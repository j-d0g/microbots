/**
 * Playwright capture of post-turn canvas screenshots.
 *
 * Runs against the dev server, captures the canvas state after each
 * query in the layout + multi_step subsets, and writes PNGs to
 * reports/screenshots/.
 *
 * Usage:
 *   node agent-evals/scripts/snapshot-rooms.mjs
 *
 * Requires the dev server running on localhost:3000 and @playwright/test
 * installed.
 *
 * Placeholder — will be wired up once the eval harness baseline is
 * established and the dev server can be programmatically driven.
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, "../reports/screenshots");

async function main() {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  console.log("snapshot-rooms: placeholder — full implementation in Sprint 1+");
  console.log(`Screenshots would be written to: ${SCREENSHOTS_DIR}`);

  // Future: launch browser, navigate to localhost:3000, send queries
  // via the chat input, wait for agent response, capture screenshots.
}

main().catch((err) => {
  console.error("snapshot-rooms error:", err);
  process.exit(1);
});
