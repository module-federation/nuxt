import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./fixtures.mjs";

test("Rspack remote hot updates inside a Vite host without losing counter state", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { root } = JSON.parse(
    await readFile(
      new URL("../reports/e2e/dev/rspack-remote-fixture.json", import.meta.url),
      "utf8",
    ),
  );
  const widgetPath = resolve(root, "app/components/exposed/Widget.vue");
  const original = await readFile(widgetPath, "utf8");
  const updatedTitle = "I'm the remote app after HMR";
  const updated = original.replace("I'm the remote app", updatedTitle);
  expect(updated).not.toBe(original);

  await page.goto("/");
  await expect(page.getByText("Hydrated", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Host counter: 0" }).click();
  const widget = page.locator(".remote-card");
  await widget.getByRole("button", { name: "Remote counter: 0" }).click();

  let documentLoads = 0;
  page.on("load", () => documentLoads++);
  try {
    await writeFile(widgetPath, updated);
    await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(documentLoads, "HMR must not reload the host document").toBe(0);
    await expect(
      page.getByRole("button", { name: "Host counter: 1" }),
    ).toBeVisible();
    await expect(
      widget.getByRole("button", { name: "Remote counter: 1" }),
    ).toBeVisible();
  } finally {
    await writeFile(widgetPath, original);
  }
});
