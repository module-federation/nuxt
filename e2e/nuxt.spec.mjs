import { expect, test } from "@playwright/test";

const button = (page, name) => page.getByRole("button", { name }).first();

test("host and SSR remote hydrate", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("I'm the host app")).toBeVisible();
  await expect(page.getByText("Host SSR component")).toBeVisible();
  await expect(page.getByText("I'm the remote app")).toBeVisible();
  await expect(page.getByText("Remote SSR component")).toBeVisible();
  await expect(page.getByText("Hydrated", { exact: true })).toHaveCount(2);

  await button(page, /Host counter: 0/).click();
  await expect(button(page, /Host counter: 1/)).toBeVisible();
  await button(page, /SSR counter: 0/).click();
  await expect(button(page, /SSR counter: 1/)).toBeVisible();

  const remoteCounters = page.getByRole("button", {
    name: /Remote counter: 0/,
  });
  await expect(remoteCounters).toHaveCount(2);
  await remoteCounters.first().click();
  await remoteCounters.last().click();
  await expect(
    page.getByRole("button", { name: /Remote counter: 1/ }),
  ).toHaveCount(2);
});

test("Bridge remote app keeps its basename while navigating", async ({
  page,
}) => {
  await page.goto("/bridge");

  await expect(
    page.getByRole("heading", { name: "Bridge remote app" }),
  ).toBeVisible();
  await expect(page.getByText("Bridge home route.")).toBeVisible();

  await page.getByRole("link", { name: "Detail", exact: true }).click();
  await expect(page).toHaveURL(/\/bridge\/detail$/);
  await expect(page.getByText(/Bridge detail route/)).toBeVisible();

  await page.goto("/bridge/detail");
  await expect(page.getByText(/Bridge detail route/)).toBeVisible();

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/bridge\/?$/);
  await expect(page.getByText("Bridge home route.")).toBeVisible();

  await page.getByRole("link", { name: "Components", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
