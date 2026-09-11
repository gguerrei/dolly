import { expect, seed, test } from "./fixtures";

test("check reports the missing file, ignores it and takes that back, then fixes it", async ({
  open,
}) => {
  const page = await open("#/check");
  await page.getByPlaceholder("/path/to/project").fill(seed().checked);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("heading", { name: "layout" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "README.md" })).toBeVisible();
  // The marker panel: the row's ignore adds a chip, the chip's remove takes it back.
  await expect(page.getByRole("heading", { name: ".dolly" })).toBeVisible();
  await page.getByRole("button", { name: "ignore" }).first().click();
  await expect(page.locator(".chips.removable")).toContainText("README.md");
  await expect(page.getByRole("heading", { name: "layout" })).toHaveCount(0);
  await page.getByTitle("Stop ignoring README.md").click();
  await expect(page.getByRole("cell", { name: "README.md" })).toBeVisible();
  await page.getByRole("button", { name: /^Fix/ }).click();
  await expect(page.getByText(/Clean: this project follows/)).toBeVisible();
});
