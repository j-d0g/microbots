import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    // Playwright owns tests/e2e — vitest must not pick those up.
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],
  },
});
