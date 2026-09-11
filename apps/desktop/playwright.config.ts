import { defineConfig } from "@playwright/test";

/**
 * The GUI walked the way the sessions walk it by hand: a daemon over a
 * seeded store (e2e/setup.ts), Chromium opening each view through the
 * tokened URL, one spec per view. `bun run e2e` here, after `bun run build`.
 */
export default defineConfig({
  testDir: "e2e",
  // `.e2e.ts`, not `.spec.ts`: bun test would otherwise pick these up and fail on Playwright's test().
  testMatch: /.*\.e2e\.ts/,
  globalSetup: "./e2e/setup.ts",
  // The specs share one daemon and edit their own projects; one worker keeps the order plain.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
