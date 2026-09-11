import { expect, seed, test } from "./fixtures";

test("export renders the pattern for the chosen target once a project is named", async ({
  open,
}) => {
  const page = await open("#/export/fixture");
  await expect(page.getByRole("heading", { name: "Export a pattern" })).toBeVisible();
  await expect(page.getByText("Name a project directory")).toBeVisible();
  await page.getByPlaceholder("/path/to/project").fill(seed().fixture);
  await expect(page.locator("main")).toContainText("biome");
});
