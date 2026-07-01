import { test, expect } from "@playwright/test";

/**
 * E2E test for per-account model whitelist.
 *
 * Exercises the UI flow in the "Edit Connection" modal:
 *   1. Empty state shows "All models allowed" + "Configure Models" button.
 *   2. Picker opens with title "Allow Models for this Account", only the
 *      current provider's models are listed, and no Combos section.
 *   3. Selecting models updates the in-modal list.
 *   4. Saving persists allowedModels; reopening the modal shows the list.
 *   5. Removing a single model updates the list; saving persists.
 *   6. "Clear all" resets the list to empty state.
 *
 * The test does not exercise the routing filter (no upstream API call). That
 * path is covered by the unit test in tests/unit/per-account-model-whitelist.test.js.
 *
 * Provider choice: `openai` — stable hardcoded LLM model list, no OAuth flow.
 * The api key is a placeholder; the modal Save path does not validate it for
 * the whitelist write (it only validates when a non-empty key is provided).
 *
 * Required env: E2E_DASHBOARD_PASSWORD (default: 123456).
 */

const DASHBOARD_PASSWORD = process.env.E2E_DASHBOARD_PASSWORD || "123456";
const PROVIDER_ID = "openai";
// Each test creates a connection with this display name. With parallel
// workers, multiple tests may run concurrently and the name must remain
// unique per test invocation (the test API deduplicates by name in some
// code paths, so a stale match would cause PUT to 404 on a connection
// that another worker has already deleted in afterEach). A timestamp +
// short random suffix makes collisions effectively impossible.
const CONNECTION_NAME = `E2E Whitelist Test ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MODELS_TO_ALLOW = ["gpt-5.4", "gpt-5"];

async function ensureLoggedIn(page) {
  // Login API occasionally 500s on first hit while Next.js compiles the
  // route. Retry up to 3 times.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await page.context().request.post("/api/auth/login", {
      data: { password: DASHBOARD_PASSWORD },
    });
    if (res.ok()) break;
    if (attempt === 3) {
      expect(res.ok(), `login (status ${res.status()})`).toBeTruthy();
    }
    await page.waitForTimeout(2000);
  }
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name === "auth_token"),
    "auth_token cookie set after login",
  ).toBe(true);
}

async function createTestConnection(page) {
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await page.request.post("/api/providers", {
      data: {
        provider: PROVIDER_ID,
        apiKey: "sk-e2e-placeholder",
        name: CONNECTION_NAME,
        displayName: CONNECTION_NAME,
      },
    });
    if (res.ok()) break;
    if (attempt === 3) {
      expect(res.ok(), `create connection (status ${res.status()})`).toBeTruthy();
    }
    await page.waitForTimeout(2000);
  }
  const { connection } = await res.json();
  expect(connection?.id, "connection id returned").toBeTruthy();
  return connection.id;
}

async function deleteConnection(page, id) {
  if (!id) return;
  await page.request.delete(`/api/providers/${id}`);
}

async function openEditConnectionModal(page) {
  // Wait for the page to exit the loading state. While `loading` is true
  // the page renders two CardSkeleton divs. Once `loading` flips to false
  // the page renders the page's own header (which contains a "Back to
  // Providers" link that's unique to this page — the sidebar has a
  // "Providers" nav link but not this back-link). The DashboardLayout's
  // header also has its own h1 ("9Router Proxy"), so we cannot wait for the
  // page's h1 alone (strict-mode violation when both render).
  await expect(
    page.getByRole("link", { name: /Back to Providers/ }),
    "provider page 'Back to Providers' link visible (loading complete)",
  ).toBeVisible({ timeout: 30_000 });

  // The connection row is identified by its display name. The row contains
  // an Edit button (with both the material "edit" icon and the text "Edit").
  // We use a non-anchored hasText regex to be robust against trailing
  // whitespace. The .first() is important: the page may render the name in
  // a tooltip / sr-only copy in addition to the main row.
  const connectionName = page
    .locator("p")
    .filter({ hasText: new RegExp(CONNECTION_NAME) })
    .first();
  await expect(connectionName, "connection name visible").toBeVisible({ timeout: 30_000 });

  // Walk up to the row container (the first ancestor with the "group" class).
  const connectionRow = connectionName.locator(
    'xpath=ancestor::div[contains(@class, "group")][1]',
  );
  await expect(connectionRow, "connection row visible").toBeVisible();

  // The Edit button — identified by the material "edit" icon. The button's
  // accessible name concatenates the icon's text and the visible "Edit" text,
  // so we can't rely on getByRole("button", { name: /Edit/ }) alone.
  const editButton = connectionRow
    .locator("button")
    .filter({ has: page.locator(".material-symbols-outlined", { hasText: /^edit$/ }) })
    .first();
  await expect(editButton, "Edit button visible").toBeVisible({ timeout: 5_000 });
  await editButton.click();

  // Edit Connection modal title.
  await expect(
    page.getByRole("heading", { name: "Edit Connection" }),
    "Edit Connection modal opens",
  ).toBeVisible({ timeout: 10_000 });

  // Wait for the allowed-models bootstrap useEffect to populate activeProviders
  // and modelAliases (the picker needs both before the Configure Models click
  // can render model rows).
  await page.waitForResponse(
    (r) => r.url().includes("/api/models/alias") && r.status() === 200,
    { timeout: 15_000 },
  ).catch(() => {});
  await page.waitForTimeout(300);
}

async function saveEditModal(page) {
  // The Edit Connection modal contains the picker modal as a child, so the
  // Save button lives inside the FIRST modal (the edit modal). We restrict
  // the locator to the edit modal to avoid hitting anything in the picker.
  const editModal = editModalLocator(page);
  const saveButton = editModal.getByRole("button", { name: /^Save$/ });
  await expect(saveButton, "Save button visible").toBeVisible({ timeout: 10_000 });
  await saveButton.click();
  // Modal closes on successful save.
  await expect(
    page.getByRole("heading", { name: "Edit Connection" }),
    "Edit Connection modal closes after save",
  ).toBeHidden({ timeout: 15_000 });
}

async function closePicker(page) {
  // The picker (ModelSelectModal) is rendered as a child of the Edit
  // Connection modal's content, sharing the page's stacking layer with its
  // own overlay. Pressing Escape would close BOTH modals (each Modal adds a
  // global keydown listener), so we click the picker's visible close button
  // and force the click past Playwright's actionability check — the click
  // target is on top of the overlay in DOM order, so it does reach the
  // button. We scope the click to the picker modal via its title.
  const pickerModal = pickerModalLocator(page);
  await expect(pickerModal, "picker modal present").toBeVisible({ timeout: 5_000 });
  await pickerModal.locator('[aria-label="Close"]:visible').first().click({ force: true });
  // Picker title should disappear.
  await expect(
    page.getByText("Allow Models for this Account", { exact: true }),
    "picker modal closes",
  ).toBeHidden({ timeout: 10_000 });
}

/**
 * Locator for the ModelSelectModal (picker). Scoped by its unique title so it
 * does not collide with the outer Edit Connection modal. The picker is a
 * child Modal, so its title is unique within the page.
 */
function pickerModalLocator(page) {
  return page
    .locator("div.fixed.inset-0")
    .filter({ has: page.getByText("Allow Models for this Account", { exact: true }) })
    .first();
}

/**
 * Locator for the Edit Connection modal. Scoped by its unique title. The
 * Allowed Models section is rendered inside this modal — using a page-level
 * `getByText("GPT-5.4")` would also match the "Available Models" section on
 * the providers page, so we always scope list/button queries through this.
 */
function editModalLocator(page) {
  return page
    .locator("div.fixed.inset-0")
    .filter({ has: page.getByRole("heading", { name: "Edit Connection" }) })
    .first();
}

test.describe("Per-account model whitelist (Edit Connection modal)", () => {
  let connectionId;

  // Warm up the dev server by compiling the dashboard page once before any
  // test runs. `request.get` to the page URL alone does NOT trigger Next.js
  // dev compilation — only a real browser navigation does. Without this,
  // the first test bears a multi-second compile cost that pushes later
  // tests past their timeouts (the page is server-rendered with
  // `loading: true` until the client hydrates and useEffect fires, so a
  // slow hydration = a stuck skeleton).
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`/dashboard/providers/${PROVIDER_ID}`, { waitUntil: "domcontentloaded" });
    } catch {
      // The page may 5xx during the first compile — the warmup is best-
      // effort. Tests do their own retry-aware open.
    } finally {
      await ctx.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000);
    await ensureLoggedIn(page);
    connectionId = await createTestConnection(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteConnection(page, connectionId);
  });

  test("empty state shows 'All models allowed' + Configure Models button", async ({ page }) => {
    await page.goto(`/dashboard/providers/${PROVIDER_ID}`);
    // No waitForLoadState here — openEditConnectionModal waits on the
    // specific post-loading marker ("Back to Providers" link) and on the
    // /api/models/alias response, which is a tighter bound than
    // networkidle's 500ms quiet-period heuristic.

    await openEditConnectionModal(page);
    const editModal = editModalLocator(page);
    await expect(editModal, "Edit Connection modal open").toBeVisible();

    // Section heading is present (scoped to the edit modal so it does not
    // collide with anything else on the providers page).
    const allowedModelsHeading = editModal.getByText("Allowed Models", { exact: true });
    await allowedModelsHeading.scrollIntoViewIfNeeded();
    await expect(allowedModelsHeading, "Allowed Models heading").toBeVisible();

    // Empty state copy.
    await expect(editModal.getByText("All models allowed")).toBeVisible();
    await expect(
      editModal.getByText("Restrict this account to a subset of provider models."),
    ).toBeVisible();

    // The "Configure Models" button.
    const configureButton = editModal.getByRole("button", { name: /Configure Models/ });
    await expect(configureButton).toBeVisible();

    // No "Add Model" button yet (only shows when list is non-empty). The
    // button's accessible name is "add Add Model" (icon glyph + text), so
    // we use a non-anchored regex to match the trailing "Add Model".
    await expect(editModal.getByRole("button", { name: /Add Model/ })).toBeHidden();
  });

  test("picker is scoped to the current provider and hides Combos", async ({ page }) => {
    await page.goto(`/dashboard/providers/${PROVIDER_ID}`);
    // No waitForLoadState here — openEditConnectionModal waits on the
    // specific post-loading marker ("Back to Providers" link) and on the
    // /api/models/alias response, which is a tighter bound than
    // networkidle's 500ms quiet-period heuristic.

    await openEditConnectionModal(page);
    const editModal = editModalLocator(page);

    await editModal.getByRole("button", { name: /Configure Models/ }).click();

    const pickerModal = pickerModalLocator(page);
    await expect(pickerModal, "picker modal opens").toBeVisible({ timeout: 10_000 });

    // Combos section is hidden inside the picker (hideCombos prop on
    // ModelSelectModal). Scope to the picker so the sidebar's "Combos" nav
    // link (a separate element) does not trigger a strict-mode violation.
    await expect(pickerModal.getByText("Combos", { exact: true })).toBeHidden();

    // The picker's provider header is the current provider's name (OpenAI).
    await expect(pickerModal.getByText("OpenAI", { exact: true }).first()).toBeVisible();

    // Spot-check: at least one OpenAI LLM model is listed. Use a stable name.
    await expect(
      pickerModal.getByRole("button", { name: "GPT-5.4", exact: true }),
      "GPT-5.4 listed in picker",
    ).toBeVisible();

    // Close the picker via its X button.
    await closePicker(page);
  });

  test("configure → save → reopen persists the whitelist", async ({ page }) => {
    await page.goto(`/dashboard/providers/${PROVIDER_ID}`);
    // No waitForLoadState here — openEditConnectionModal waits on the
    // specific post-loading marker ("Back to Providers" link) and on the
    // /api/models/alias response, which is a tighter bound than
    // networkidle's 500ms quiet-period heuristic.

    await openEditConnectionModal(page);
    const editModal = editModalLocator(page);

    // Open the picker and add models.
    await editModal.getByRole("button", { name: /Configure Models/ }).click();
    const pickerModal = pickerModalLocator(page);
    await expect(pickerModal).toBeVisible({ timeout: 10_000 });

    for (const model of MODELS_TO_ALLOW) {
      const button = pickerModal.getByRole("button", { name: modelDisplayName(model), exact: true });
      await expect(button, `${model} button visible in picker`).toBeVisible({ timeout: 5_000 });
      await button.click();
    }

    // Close the picker via its X button.
    await closePicker(page);

    // The modal list should now show one X remove button per picked model.
    // The remove button's accessible name is "Remove <alias>" (where <alias>
    // is either the model alias from /api/models/alias, or the raw model id
    // when no alias map entry exists). We don't depend on the exact alias
    // text — we just count the remove buttons scoped to the edit modal.
    await expect(
      editModal.locator('button[aria-label^="Remove "]'),
      `${MODELS_TO_ALLOW.length} remove buttons in modal list`,
    ).toHaveCount(MODELS_TO_ALLOW.length);

    // The "Add Model" button has appeared; the empty-state Configure Models
    // button has gone. The button's accessible name is "add Add Model"
    // (icon glyph + text), so we use a non-anchored regex to match the
    // trailing "Add Model" and scope to the edit modal.
    await expect(editModal.getByRole("button", { name: /Add Model/ })).toBeVisible();
    // The empty-state heading "All models allowed" must be hidden once the
    // list is non-empty. The info text "Empty = all models allowed." also
    // appears in this state, so the match must be exact.
    await expect(editModal.getByText("All models allowed", { exact: true })).toBeHidden();

    // Save.
    await saveEditModal(page);

    // Verify persistence: re-fetch the connection and confirm the saved whitelist.
    const after = await page.request.get(`/api/providers`);
    expect(after.ok(), `list providers (status ${after.status()})`).toBeTruthy();
    const body = await after.json();
    const found = (body.connections || []).find((c) => c.id === connectionId);
    expect(found, "test connection present after save").toBeTruthy();
    expect(
      Array.isArray(found.allowedModels) && found.allowedModels.length === MODELS_TO_ALLOW.length,
      `expected allowedModels length ${MODELS_TO_ALLOW.length}, got ${JSON.stringify(found.allowedModels)}`,
    ).toBe(true);
    for (const model of MODELS_TO_ALLOW) {
      const fullValue = `${PROVIDER_ID}/${model}`;
      expect(
        found.allowedModels.includes(fullValue),
        `allowedModels includes ${fullValue}; got ${JSON.stringify(found.allowedModels)}`,
      ).toBe(true);
    }
  });

  test("removing a model and 'Clear all' update the saved whitelist", async ({ page }) => {
    // Seed the connection with two models via the API so the UI test focuses
    // purely on the remove/clear flow rather than re-walking the picker.
    const seed = MODELS_TO_ALLOW.map((m) => `${PROVIDER_ID}/${m}`);
    const seedRes = await page.request.put(`/api/providers/${connectionId}`, {
      data: { allowedModels: seed },
    });
    expect(seedRes.ok(), `seed whitelist (status ${seedRes.status()})`).toBeTruthy();

    await page.goto(`/dashboard/providers/${PROVIDER_ID}`);
    // No waitForLoadState here — openEditConnectionModal waits on the
    // specific post-loading marker ("Back to Providers" link) and on the
    // /api/models/alias response, which is a tighter bound than
    // networkidle's 500ms quiet-period heuristic.

    await openEditConnectionModal(page);
    const editModal = editModalLocator(page);

    // Both models appear in the configured list. We don't match by displayed
    // text (the alias can be either the raw model id or a friendly name
    // depending on the alias map). Instead, count the remove buttons scoped
    // to the edit modal — one per allowed model.
    const removeButtons = editModal.locator('button[aria-label^="Remove "]');
    await expect(
      removeButtons,
      `${MODELS_TO_ALLOW.length} remove buttons in seeded modal list`,
    ).toHaveCount(MODELS_TO_ALLOW.length);

    // Click the first remove button. We can't reliably target by model text
    // (the alias is data-dependent), so we click the first button and rely
    // on the post-click API check to confirm which model was removed.
    await removeButtons.first().click();

    // Only one remove button remains in the modal.
    await expect(
      editModal.locator('button[aria-label^="Remove "]'),
      "1 remove button after removing first model",
    ).toHaveCount(1);

    await saveEditModal(page);

    // Verify the persisted state has dropped the first model only.
    const after = await page.request.get(`/api/providers`);
    const body = await after.json();
    const found = (body.connections || []).find((c) => c.id === connectionId);
    expect(found.allowedModels).toEqual([`${PROVIDER_ID}/${MODELS_TO_ALLOW[1]}`]);

    // Reopen the modal. The page is still on the providers route; we just
    // need to wait for the connections list to re-render after fetch_().
    await openEditConnectionModal(page);
    const reopenedModal = editModalLocator(page);
    await expect(
      reopenedModal.locator('button[aria-label^="Remove "]'),
      "1 remove button after reopen",
    ).toHaveCount(1);

    await reopenedModal.getByRole("button", { name: /Clear all/ }).click();

    // Back to empty state.
    await expect(reopenedModal.getByText("All models allowed")).toBeVisible();
    await expect(reopenedModal.getByRole("button", { name: /Add Model/ })).toBeHidden();
    await expect(
      reopenedModal.locator('button[aria-label^="Remove "]'),
      "no remove buttons after clear",
    ).toHaveCount(0);

    await saveEditModal(page);

    // Verify the persisted state is empty (null after server-side normalization).
    const final = await page.request.get(`/api/providers`);
    const finalBody = await final.json();
    const finalFound = (finalBody.connections || []).find((c) => c.id === connectionId);
    // The API normalizes an empty list to `null`; either means "no whitelist".
    expect(
      finalFound.allowedModels === null ||
        (Array.isArray(finalFound.allowedModels) && finalFound.allowedModels.length === 0),
      `expected null/empty allowedModels, got ${JSON.stringify(finalFound.allowedModels)}`,
    ).toBe(true);
  });
});

/** OpenAI display name (matches providerModels.js). */
function modelDisplayName(modelId) {
  const map = {
    "gpt-5.4": "GPT-5.4",
    "gpt-5": "GPT-5",
    "gpt-4o": "GPT-4o",
  };
  return map[modelId] || modelId;
}
