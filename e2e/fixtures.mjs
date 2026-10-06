import { expect, test as base } from "@playwright/test";

export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    const recordError = (message) => {
      errors.push(message.replace(/([?&]token=)[^&\s"']+/g, "$1[redacted]"));
    };
    const applicationResources = new Set([
      "script",
      "stylesheet",
      "fetch",
      "xhr",
    ]);

    page.on("pageerror", (error) => recordError(error.stack ?? error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" ||
        (message.type() === "warning" && /hydration/i.test(message.text()))
      ) {
        recordError(message.text());
      }
    });
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        applicationResources.has(response.request().resourceType())
      ) {
        recordError(`${response.status()} ${response.url()}`);
      }
    });
    page.on("requestfailed", (request) => {
      const error = request.failure()?.errorText;
      if (
        applicationResources.has(request.resourceType()) &&
        error !== "net::ERR_ABORTED"
      ) {
        recordError(`${error}: ${request.url()}`);
      }
    });

    await use(page);

    expect(
      errors,
      "Browser errors, hydration mismatches, or failed assets",
    ).toEqual([]);
  },
});
