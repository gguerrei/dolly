import { expect, test } from "./fixtures";

test("the library lists the extracted pattern and opens it", async ({ open }) => {
  const page = await open("#/");
  await expect(page.getByRole("heading", { name: "Patterns" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "fixture" });
  await expect(row.getByText("valid", { exact: true })).toBeVisible();
  await row.getByRole("link", { name: "fixture" }).click();
  await expect(page.getByRole("heading", { name: "fixture" })).toBeVisible();
});
