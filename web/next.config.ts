import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Allow a second concurrent `next dev` from the same `web/` dir
  // (e.g. parallel worktrees, a teammate already running) by giving
  // it its own dist dir + lock. Defaults to `.next` for normal runs.
  // See web/README.md "Port conflicts and dev-server locks".
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default config;
