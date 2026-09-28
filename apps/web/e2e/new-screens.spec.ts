import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the screens added by the Canada Life IDP reskin.
 * These routes are all backed by client-side aggregation over the existing
 * process/job endpoints, so a real navigation is enough to prove the page
 * renders under an authenticated session (storageState from global-setup)
 * without throwing.
 */
const newScreens: Array<{ path: string; heading: string }> = [
  { path: "/dashboard", heading: "System Operations Dashboard" },
  { path: "/review-queue", heading: "Document Review Queue" },
  { path: "/form-models", heading: "Form Models" },
  { path: "/integrations", heading: "API & Integrations" },
  { path: "/admin/users", heading: "Users" },
];

for (const screen of newScreens) {
  test(`${screen.path} renders for an authenticated session`, async ({ page }) => {
    await page.goto(screen.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: screen.heading })).toBeVisible();
    // The RouteGuard would have bounced us to /login if the session were
    // missing or rejected; asserting the URL confirms it did not.
    await expect(page).toHaveURL(new RegExp(`${screen.path.replace(/\//g, "\\/")}$`));
  });
}

test("signed-out visitors are redirected to /login and can sign back in", async ({ browser }) => {
  // Use a storage-state-free context so this test does not inherit the
  // pre-authenticated session configured for the rest of the suite.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();

  try {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);

    await page.getByLabel("Work email").fill("e2e-playwright@example.com");
    await page.getByLabel("Password", { exact: true }).fill("e2e-playwright-password");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "System Operations Dashboard" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
