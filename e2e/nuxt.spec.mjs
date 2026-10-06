import { expect, test } from "./fixtures.mjs";

test("host renders remote components in the initial HTML before hydration", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");

  // Inspect the HTTP response, not the DOM after client rendering. Exclude
  // inline scripts so a serialized payload cannot satisfy the SSR assertions.
  const markup = (await response.text()).replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    "",
  );
  expect(markup).toContain('id="__nuxt"');
  expect(markup).toContain('class="host-ssr-card"');
  expect(markup).toContain("Host SSR component");
  expect(markup).toContain('class="remote-card"');
  expect(markup).toMatch(/I(?:'|&#39;)m the remote app/);
  expect(markup).toContain('class="remote-ssr-card"');
  expect(markup).toContain("Remote SSR component");
  expect(markup).toContain("Rendered by remote before client hydration.");
  expect(markup.match(/>\s*SSR\s*<\//g)).toHaveLength(2);
  expect(markup).not.toContain("Hydrated");
  expect(markup).not.toContain("SSR counter:");
  expect(markup).not.toContain("Remote counter:");
});

test("host and SSR remote hydrate", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("I'm the host app")).toBeVisible();
  await expect(page.getByText("Host SSR component")).toBeVisible();
  await expect(page.getByText("I'm the remote app")).toBeVisible();
  await expect(page.getByText("Remote SSR component")).toBeVisible();
  await expect(page.getByText("Hydrated", { exact: true })).toHaveCount(2);

  await page.getByRole("button", { name: "Host counter: 0" }).click();
  await expect(
    page.getByRole("button", { name: "Host counter: 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "SSR counter: 0" }).click();
  await expect(
    page.getByRole("button", { name: "SSR counter: 1" }),
  ).toBeVisible();

  const widget = page.locator(".remote-card");
  const ssrCounter = page.locator(".remote-ssr-card");
  await widget.getByRole("button", { name: "Remote counter: 0" }).click();
  await expect(
    widget.getByRole("button", { name: "Remote counter: 1" }),
  ).toBeVisible();
  await expect(
    ssrCounter.getByRole("button", { name: "Remote counter: 0" }),
  ).toBeVisible();
  await ssrCounter.getByRole("button", { name: "Remote counter: 0" }).click();
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
  await expect(page.getByText("Hydrated", { exact: true })).toHaveCount(2);
});
