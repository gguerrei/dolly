import { expect, seed, test } from "./fixtures";

test("fit plans the create step for the missing file", async ({ open }) => {
  const page = await open("#/fit");
  await page.getByPlaceholder("/path/to/project").fill(seed().fitted);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByText("README.md").first()).toBeVisible();
  await expect(page.getByText("create").first()).toBeVisible();
});
