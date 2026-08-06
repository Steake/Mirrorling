import { expect, test } from "@playwright/test";

test("runs production behaviour, a staged API and a client-only production handoff", async ({ page }) => {
  await page.goto("/?__bench_scenario=checkout-v2");
  await page.goto("/checkout?ref=e2e");

  await expect(page.locator("html")).toHaveAttribute("data-checkout-overlay", "ready");
  await expect(page.locator("#bench-offer-title")).toContainText("sharper checkout");
  await expect(page.locator("#production-counter span")).toHaveText("0");
  await page.locator("#production-counter").click();
  await expect(page.locator("#production-counter span")).toHaveText("1");

  await page.locator("#load-recommendation").click();
  await expect(page.locator("#recommendation-result")).toContainText("Overlay result");

  await Promise.all([
    page.waitForURL(/^http:\/\/127\.0\.0\.1:4311\/account\?/),
    page.locator("#finish-client-flow").click(),
  ]);
  const state = new URL(page.url()).searchParams.get("bench_state");
  expect(state).not.toBeNull();
  expect(JSON.parse(state ?? "{}")).toMatchObject({
    version: 1,
    scenario: "checkout-v2",
    handoff: "finish-client-flow",
    state: { plan: "pro", coupon: "BENCH20" },
  });
  await expect(page.locator("#account-title")).toHaveText("Production resumed");
});

test("keeps ordinary absolute production navigation inside staging", async ({ page }) => {
  await page.goto("/checkout");
  await page.locator("#absolute-account-link").click();
  await expect(page).toHaveURL("http://127.0.0.1:4312/account");
});
