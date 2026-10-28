import { expect, test } from "@playwright/test";

test("client-only remote navigation does not throw during route updates", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Dashboard" }).click();

  await expect(page.getByTestId("remote-widget")).toHaveText("dashboard");
  expect(errors).toEqual([]);
});
