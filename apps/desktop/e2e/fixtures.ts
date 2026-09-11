import { test as base, expect, type Page } from "@playwright/test";
import type { Seed } from "./setup";

/** What the global setup seeded: the daemon's URL and the projects. */
export function seed(): Seed {
  const raw = process.env.DOLLY_E2E;
  if (!raw) throw new Error("DOLLY_E2E is not set; the global setup did not run.");
  return JSON.parse(raw) as Seed;
}

/**
 * `open("#/check")` adopts the daemon's token the way the printed URL does,
 * then moves to the view. Any console error or uncaught exception on the
 * page fails the test at its end: a view that renders but logs is broken.
 */
export const test = base.extend<{ open: (hash: string) => Promise<Page> }>({
  open: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await use(async (hash) => {
      const { url } = seed();
      await page.goto(url);
      await page.goto(`${url.split("#")[0]}${hash}`);
      return page;
    });
    expect(errors, "the page logged errors").toEqual([]);
  },
});

export { expect };
