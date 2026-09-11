import { expect, test } from "./fixtures";

test("the pattern view shows the overview, the source, and a captured file", async ({ open }) => {
  const page = await open("#/pattern/fixture");
  await expect(page.getByRole("heading", { name: "fixture" })).toBeVisible();
  await expect(page.getByText("biome").first()).toBeVisible();
  await page.getByRole("button", { name: "Source" }).click();
  await expect(page.locator(".cm-content")).toContainText("name: fixture");
  await page.getByRole("button", { name: /biome\.json/ }).click();
  await expect(page.locator(".cm-content")).toContainText("formatter");
});
