import { expect, test } from "./fixtures";

test("settings lists the providers with AI off", async ({ open }) => {
  const page = await open("#/settings");
  await expect(page.getByRole("heading", { name: "AI", exact: true })).toBeVisible();
  await expect(page.getByText(/anthropic/i).first()).toBeVisible();
});
