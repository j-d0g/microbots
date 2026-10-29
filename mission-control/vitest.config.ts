import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": `${root}tests/server-only.ts`,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
