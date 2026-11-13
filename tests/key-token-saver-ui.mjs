// Run against an isolated local dev server, never a production instance:
// QA_BASE_URL=http://localhost:20127 QA_PASSWORD=... QA_BROWSER=/path/to/chrome node tests/key-token-saver-ui.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.QA_BASE_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw new Error("QA_BASE_URL must point to an isolated localhost server");
}
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
let key;
let otherKey;
let originalSettings;
const cleanupErrors = [];
const api = page.request;
const suffix = Date.now();
const keyName = `Token saver UI smoke ${suffix}`;
const otherKeyName = `Independent key ${suffix}`;
const waitFor = async (predicate) => {
  for (let n = 0; n < 100; n++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for UI state");
};
const checked = async (switchControl) => (await switchControl.getAttribute("aria-checked")) === "true";

try {
  const login = await api.post(`${base}/api/auth/login`, { data: { password: process.env.QA_PASSWORD }, timeout: 120000 });
  assert.equal(login.ok(), true, await login.text());
  originalSettings = await (await api.get(`${base}/api/settings`)).json();
  const globals = { rtkEnabled: true, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false };
  assert.equal((await api.patch(`${base}/api/settings`, { data: globals })).ok(), true);
  const created = await api.post(`${base}/api/keys`, { data: { name: keyName } });
  assert.equal(created.ok(), true);
  key = await created.json();
  const second = await api.post(`${base}/api/keys`, { data: { name: otherKeyName } });
  assert.equal(second.ok(), true);
  otherKey = await second.json();
  await page.goto(`${base}/dashboard/endpoint`);
  const rowFor = (name) => page.getByText(name, { exact: true }).locator("..").getByTestId("key-token-saver");
  const editor = rowFor(keyName);
  await editor.waitFor();
  const override = editor.getByRole("switch", { name: "Override token saver settings", exact: true });
  const master = editor.getByRole("switch", { name: "Token savers", exact: true });
  const rtk = editor.getByRole("switch", { name: "RTK", exact: true });
  const headroom = editor.getByRole("switch", { name: "Headroom", exact: true });
  assert.equal(await master.count(), 0);
  assert.equal(await editor.evaluate((el) => el.previousElementSibling?.getAttribute("data-testid")), "key-access");
  await waitFor(() => override.isEnabled());

  // Change server defaults after the dashboard has cached its initial settings.
  assert.equal((await api.patch(`${base}/api/settings`, { data: { ...globals, rtkEnabled: false } })).ok(), true);
  let settingsRequests = 0;
  let activationSaves = 0;
  const countActivationSave = (request) => {
    if (request.url() === `${base}/api/keys/${key.id}` && request.method() === "PUT") activationSaves++;
  };
  page.on("request", countActivationSave);
  await page.route("**/api/settings", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    settingsRequests++;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated refresh failure" }) });
  });
  await override.click();
  await editor.getByRole("alert").waitFor();
  assert.match(await editor.getByRole("alert").innerText(), /Failed to refresh global token saver settings/);
  assert.equal(await checked(override), false);
  assert.equal(await master.count(), 0);
  assert.equal(activationSaves, 0);
  await page.unroute("**/api/settings");

  let releaseRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  const heldRefresh = new Promise((resolve) => { releaseRefresh = resolve; });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    settingsRequests++;
    markRefreshStarted();
    await heldRefresh;
    await route.continue();
  });
  await override.click();
  await refreshStarted;
  assert.equal(await override.isDisabled(), true);
  assert.equal(activationSaves, 0);
  releaseRefresh();
  await waitFor(() => checked(override));
  assert.equal(await checked(master), true);
  assert.equal(await checked(rtk), false);
  assert.equal(await checked(headroom), false);
  assert.equal(activationSaves, 1);
  assert.equal(settingsRequests, 2);
  page.off("request", countActivationSave);
  await page.unroute("**/api/settings");
  await rtk.click();
  await waitFor(() => checked(rtk));
  await headroom.click();
  await waitFor(() => checked(headroom));
  assert.equal(await checked(rowFor(otherKeyName).getByRole("switch", { name: "Override token saver settings", exact: true })), false);
  await master.click();
  await waitFor(async () => !(await checked(master)));
  for (const label of ["RTK", "Headroom", "Caveman", "Ponytail"]) {
    assert.equal(await editor.getByRole("switch", { name: label, exact: true }).isDisabled(), true);
  }
  assert.equal(await checked(headroom), true);
  await override.click();
  await waitFor(async () => (await master.count()) === 0);
  // Restoring saved choices must not depend on settings availability.
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "GET") settingsRequests++;
    return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  await override.click();
  await waitFor(() => checked(override));
  assert.equal(settingsRequests, 2);
  await page.unroute("**/api/settings");
  assert.equal(await checked(master), false);
  assert.equal(await checked(headroom), true);
  await master.click();
  await waitFor(() => checked(master));
  assert.equal(await headroom.isEnabled(), true);

  let releaseSave;
  let markSaveStarted;
  const saveStarted = new Promise((resolve) => { markSaveStarted = resolve; });
  const heldSave = new Promise((resolve) => { releaseSave = resolve; });
  await page.route(`**/api/keys/${key.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    markSaveStarted();
    await heldSave;
    await route.continue();
  });
  await rtk.click();
  await saveStarted;
  assert.equal(await override.isDisabled(), true);
  assert.equal(await master.isDisabled(), true);
  assert.equal(await headroom.isDisabled(), true);
  releaseSave();
  await waitFor(async () => !(await checked(rtk)) && await override.isEnabled());
  await page.unroute(`**/api/keys/${key.id}`);
  await rtk.click();
  await waitFor(() => checked(rtk));
  await override.click();
  await waitFor(async () => (await master.count()) === 0);
  await override.click();
  await waitFor(() => checked(override));
  assert.equal(await checked(headroom), true);
  await page.reload();
  await editor.waitFor();
  assert.equal(await checked(headroom), true);

  await page.route(`**/api/keys/${key.id}`, (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated save failure" }) })
    : route.continue());
  await rtk.click();
  await editor.getByRole("alert").waitFor();
  assert.equal(await checked(rtk), true);
  assert.match(await editor.getByRole("alert").innerText(), /Simulated save failure/);
  await page.unroute(`**/api/keys/${key.id}`);
  await page.route(`**/api/keys/${key.id}`, (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ key: null }) })
    : route.continue());
  await rtk.click();
  await waitFor(async () => (await editor.getByRole("alert").innerText()).includes("Invalid token saver save response"));
  assert.equal(await checked(rtk), true);
  await page.unroute(`**/api/keys/${key.id}`);
  await rtk.focus();
  await page.keyboard.press("Space");
  await waitFor(async () => !(await checked(rtk)));
  assert.equal(await editor.getByRole("alert").count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await override.isVisible(), true);
  const row = await (await api.get(`${base}/api/keys/${key.id}`)).json();
  assert.equal(row.key.tokenSaver.headroomEnabled, true);
  assert.equal(row.key.tokenSaver.rtkEnabled, false);

  await page.goto(`${base}/dashboard/token-saver`);
  const cavemanDefault = page.getByRole("switch", { name: "Caveman enabled by default" });
  await cavemanDefault.waitFor();
  assert.equal(await checked(cavemanDefault), false);
  assert.equal(await page.getByRole("button", { name: "Lite", exact: true }).count(), 2);
  assert.equal(await page.getByRole("button", { name: "Lite", exact: true }).first().isEnabled(), true);
  const levelSave = page.waitForResponse((response) => response.url().endsWith("/api/settings") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Lite", exact: true }).first().click();
  assert.equal((await levelSave).ok(), true);
  const shared = await (await api.get(`${base}/api/settings`)).json();
  assert.equal(shared.cavemanEnabled, false);
  assert.equal(shared.cavemanLevel, "lite");
  console.log("PASS: inheritance, fresh activation snapshot, refresh failure/retry, refresh pending guard, reactivation without refresh, master gating, retention/reload, key isolation, save pending guard, error/retry, keyboard, mobile visibility, editing global-OFF levels");
} finally {
  const cleanup = async (request) => {
    try {
      const response = await request();
      if (!response.ok()) throw new Error(`Cleanup returned HTTP ${response.status()}`);
    } catch (error) {
      cleanupErrors.push(error.message);
    }
  };
  if (key) await cleanup(() => api.delete(`${base}/api/keys/${key.id}`));
  if (otherKey) await cleanup(() => api.delete(`${base}/api/keys/${otherKey.id}`));
  if (originalSettings) await cleanup(() => api.patch(`${base}/api/settings`, { data: Object.fromEntries(["rtkEnabled", "headroomEnabled", "cavemanEnabled", "ponytailEnabled", "cavemanLevel"].map((field) => [field, originalSettings[field]])) }));
  await browser.close();
  if (cleanupErrors.length) {
    console.error("Smoke cleanup failed:", cleanupErrors.join("; "));
    process.exitCode = 1;
  }
}
