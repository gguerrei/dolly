import { expect, test } from "./fixtures";

test("learn opens on its empty state", async ({ open }) => {
  const page = await open("#/learn");
  await expect(page.getByRole("heading", { name: "Learn from a project" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing learned yet" })).toBeVisible();
});
