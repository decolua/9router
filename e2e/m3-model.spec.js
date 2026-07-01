import { test, expect } from "@playwright/test";

/**
 * E2E test for MiniMax-M3 model support.
 *
 * The "Test" button in the UI calls POST /api/models/test, which internally
 * hits /api/v1/chat/completions on the running router. That endpoint must
 * pick the correct upstream format (claude) for M3 — otherwise the upstream
 * response lacks a `choices` array and the UI surfaces it as an error.
 *
 * This spec exercises that path end-to-end with real upstream API keys.
 *
 * Required environment variables (test is skipped if any are missing):
 *   E2E_MINIMAX_API_KEY    — API key for `minimax` (international)
 *   E2E_MINIMAX_CN_API_KEY — API key for `minimax-cn`
 *   E2E_DASHBOARD_PASSWORD — dashboard login password (default: 123456)
 *
 * Run:
 *   E2E_MINIMAX_API_KEY=... E2E_MINIMAX_CN_API_KEY=... npx playwright test
 */

const DASHBOARD_PASSWORD = process.env.E2E_DASHBOARD_PASSWORD || "123456";

const PROVIDERS = [
  {
    id: "minimax",
    apiKeyEnv: "E2E_MINIMAX_API_KEY",
    name: "E2E M3 (minimax intl)",
  },
  {
    id: "minimax-cn",
    apiKeyEnv: "E2E_MINIMAX_CN_API_KEY",
    name: "E2E M3 (minimax cn)",
  },
];

/**
 * Login flow — authenticate the browser context by calling the login API directly
 * with `context.request` (not `page.request`). The Set-Cookie response is applied
 * to the context, so subsequent page navigations and page.request calls are authed.
 *
 * On a fresh install the password is "123456".
 */
async function ensureLoggedIn(page) {
  // Retry up to 3 times — Next.js dev server occasionally returns 500
  // ("Manifest file is empty") when compiling a route on first hit.
  let loginRes;
  for (let attempt = 1; attempt <= 3; attempt++) {
    loginRes = await page.context().request.post("/api/auth/login", {
      data: { password: DASHBOARD_PASSWORD },
    });
    if (loginRes.ok()) break;
    if (attempt === 3) {
      expect(loginRes.ok(), `login (status ${loginRes.status()})`).toBeTruthy();
    }
    await page.waitForTimeout(2000);
  }

  // Sanity: the auth_token cookie should now be set on the context
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name === "auth_token"),
    `auth_token cookie is set after login (cookies: ${cookies.map((c) => c.name).join(", ")})`,
  ).toBe(true);
}

/**
 * Click the "Test" button on the M3 model row in the provider detail page
 * and wait for the result icon to settle (check_circle = ok, cancel = error).
 */
async function clickM3TestButton(page, providerDisplayAlias) {
  // The detail page shows skeleton placeholders while connections/models fetch.
  // Wait for the page to be interactive (no more skeleton loaders), then look
  // for the M3 model <code> element. Long timeout — dev server is slow on first
  // route compilation.
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

  // The M3 row is rendered as:
  //   <div class="rounded-lg border ...">
  //     ...
  //     <code>{providerDisplayAlias}/MiniMax-M3</code>
  //     ...
  // We locate the <code> first, then walk up to the row container.
  const m3Code = page.locator("code", {
    hasText: `${providerDisplayAlias}/MiniMax-M3`,
  }).first();
  await expect(m3Code, `M3 <code> visible for ${providerDisplayAlias}`).toBeVisible({ timeout: 60_000 });

  // Walk up to the row container (the first ancestor with "rounded-lg border")
  const m3Row = m3Code.locator(
    'xpath=ancestor::div[contains(@class, "rounded-lg")][1]',
  );

  // The test button is the one with the "science" / "progress_activity" icon
  const testButton = m3Row.locator("button").filter({
    has: page.locator(".material-symbols-outlined", { hasText: /science|progress_activity/ }),
  }).first();
  await expect(testButton, `M3 test button visible for ${providerDisplayAlias}`).toBeVisible({ timeout: 5_000 });

  await testButton.click();

  // Wait for status to settle: either check_circle (ok) or cancel (error) appears
  const statusIcon = m3Row.locator(".material-symbols-outlined", {
    hasText: /check_circle|cancel/,
  });
  await expect(statusIcon, `M3 test result icon for ${providerDisplayAlias}`).toBeVisible({ timeout: 30_000 });
  return (await statusIcon.textContent())?.trim();
}

test.describe("MiniMax-M3 model — UI test button flow", () => {
  for (const provider of PROVIDERS) {
    test(`${provider.id} — test button reports ok for MiniMax-M3`, async ({ page }) => {
      test.setTimeout(180_000); // dev server is slow on first route compilation
      const apiKey = process.env[provider.apiKeyEnv];
      test.skip(!apiKey, `${provider.apiKeyEnv} not set — skipping live test for ${provider.id}`);

      // 1. Login first (sets the auth cookie on the browser context).
      //    Subsequent page.request calls share this cookie automatically.
      await ensureLoggedIn(page);

      // 2. Create the provider connection via API (uses the page's auth context).
      //    Retry up to 3 times — Next.js dev server occasionally returns 500 ("Manifest
      //    file is empty") on first route compilation under load.
      let createRes;
      let connectionId;
      for (let attempt = 1; attempt <= 3; attempt++) {
        createRes = await page.request.post("/api/providers", {
          data: {
            provider: provider.id,
            apiKey,
            name: provider.name,
            displayName: provider.name,
          },
        });
        if (createRes.ok()) break;
        console.warn(`create provider ${provider.id} attempt ${attempt} failed: ${createRes.status()}`);
        if (attempt === 3) {
          expect(createRes.ok(), `create provider ${provider.id} (status ${createRes.status()})`).toBeTruthy();
        }
        await page.waitForTimeout(2000);
      }
      const { connection } = await createRes.json();
      connectionId = connection?.id;
      expect(connectionId, "connection id").toBeTruthy();

      try {
        // 3. Navigate to the provider detail page.
        //    The [id] route param is the provider name (e.g. "minimax"), not the connection id —
        //    the detail page lists every connection for that provider, and a test button only
        //    renders when at least one connection is present.
        await page.goto(`/dashboard/providers/${provider.id}`);

        // 4. Click the test button on the M3 row and read the result icon
        //    (clickM3TestButton waits for the M3 <code> element to render, which implicitly
        //    waits for the connection fetch and model list to populate.)
        const resultIcon = await clickM3TestButton(page, provider.id);
        expect(resultIcon, `M3 test icon should be check_circle (ok), got: ${resultIcon}`).toBe("check_circle");
      } finally {
        // Cleanup
        await page.request.delete(`/api/providers/${connectionId}`);
      }
    });
  }
});
