/**
 * The quota tracker's grouped view, in a real browser.
 *
 *   node scripts/fork/check-quota-view.mjs
 *
 * The view's logic is unit-tested (tests/unit/quota-grouped-view.test.js), but
 * logic passing is not the same as the page working. Server-rendered HTML does
 * not settle it either: the tracker fetches its connections from the client, so
 * nothing but a skeleton exists until that lands.
 *
 * So this drives the actual page: boot the built Next server, add a routable
 * account so the tracker has something to show, open /dashboard/quota in
 * Chromium, switch to "By provider", and read the DOM that comes out.
 *
 * Needs playwright-core (`cd tests && npm i -D playwright-core`) and a Chromium
 * that Playwright has already downloaded; it does not fetch one. Skips with a
 * clear message rather than failing when either is missing, so it stays usable
 * on a machine that has neither.
 *
 * Needs port 21998 free.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = process.env.ROUTER_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 21998;
const PASSWORD = "quota-view-test-password";
const DATA_DIR = path.join(os.tmpdir(), `9r-quota-view-${Date.now()}`);
// Two accounts of one provider, so grouping and its picker have something
// real to do, and so a per-card assertion can tell "once per card" apart
// from "once on the page".
const ACCOUNT_SUFFIXES = ["a", "b"];
const ACCOUNTS = ACCOUNT_SUFFIXES.length;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};

/** Any Chromium Playwright has already downloaded, newest first. */
function findChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "AppData", "Local", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root)
      .filter((d) => d.startsWith("chromium-"))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const dir of dirs) {
      for (const rel of [
        ["chrome-win64", "chrome.exe"],
        ["chrome-win", "chrome.exe"],
        ["chrome-linux", "chrome"],
        ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
      ]) {
        const exe = path.join(root, dir, ...rel);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const call = (opts, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, timeout: 180000, ...opts }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => {
      let json = null;
      try { json = JSON.parse(data); } catch { /* html or empty */ }
      resolve({ status: res.statusCode, headers: res.headers, body: data, json });
    });
  });
  r.on("error", reject);
  r.on("timeout", () => r.destroy(new Error("request timeout")));
  if (body) r.write(body);
  r.end();
});

const waitFor = async (fn, ms, label) => {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${label} (${last})`);
};

const require_ = createRequire(import.meta.url);
let chromiumLauncher;
try {
  ({ chromium: chromiumLauncher } = require_(path.join(ROOT, "tests", "node_modules", "playwright-core")));
} catch {
  try { ({ chromium: chromiumLauncher } = require_("playwright-core")); } catch { /* handled below */ }
}
const executablePath = findChromium();

if (!chromiumLauncher || !executablePath) {
  console.log(`  SKIP  browser check (${!chromiumLauncher
    ? "playwright-core not installed — cd tests && npm i -D playwright-core"
    : "no Chromium downloaded by Playwright on this machine"})`);
  process.exit(0);
}

let server;
let browser;
let log = "";
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.JWT_SECRET;
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.log("  SKIP  browser check (no production build — run `npx next build` first)");
    process.exit(0);
  }
  server = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT)], {
      cwd: ROOT,
      env: {
        ...env,
        DATA_DIR,
        INITIAL_PASSWORD: PASSWORD,
        PORT: String(PORT),
        NODE_OPTIONS: `--require "${path.join(ROOT, "custom-server.js").replace(/\\/g, "/")}"`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });

  await waitFor(async () => (await call({ method: "GET", path: "/api/health" })).status < 500,
    240000, "the built server to answer");

  const login = await call({ method: "POST", path: "/api/auth/login", headers: { "content-type": "application/json" } },
    JSON.stringify({ password: PASSWORD }));
  const m = /auth_token=([^;]+)/.exec([].concat(login.headers["set-cookie"] || []).join("; "));
  if (!m) throw new Error("no session cookie from login");
  const token = m[1];
  const json = { cookie: `auth_token=${token}`, "content-type": "application/json" };

  // Two accounts of one provider, so the grouping and its picker have
  // something real to group. claude-cli takes an opaque token here.
  for (const suffix of ACCOUNT_SUFFIXES) {
    await call({ method: "POST", path: "/api/cli-tools/claude-cli-accounts", headers: json },
      JSON.stringify({ oauthToken: `sk-ant-oat01-view-${suffix}`, name: `View account ${suffix}` }));
  }

  browser = await chromiumLauncher.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: "auth_token", value: token, domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const consoleMsgs = [];
  page.on("console", (msg) => { if (msg.type() === "error" || msg.type() === "warning") consoleMsgs.push(msg.text().slice(0, 200)); });

  await page.goto(`http://127.0.0.1:${PORT}/dashboard/quota`, { waitUntil: "networkidle", timeout: 120000 });

  // The switch is what makes the new view reachable at all.
  const byProvider = page.getByRole("button", { name: "By provider" });
  try {
    await byProvider.waitFor({ state: "visible", timeout: 60000 });
  } catch (e) {
    console.log(`--- page text ---\n${(await page.locator("body").innerText()).slice(0, 1500)}`);
    throw e;
  }
  check("the view switch is rendered on the quota page", true);

  // The flat "By account" view first, because it is the default and the one
  // this check originally skipped: a provider that reports no upstream quota
  // sends figures *and* a message saying whose numbers they are, and the flat
  // view treated any message as "there is nothing to show" — so it hid the
  // figures entirely and printed the message twice.
  const messageText = /Counted by 9Router/;
  const cardText = async () => (await page.locator("body").innerText());

  await waitFor(async () => messageText.test(await cardText()), 60000,
    "the routed-usage card to load");
  const flat = await cardText();
  const flatMessages = (flat.match(new RegExp(messageText.source, "g")) || []).length;
  // One card per account here, so one note per account. The bug printed it
  // twice per card — once in place of the table and once underneath — so this
  // reads 4 when it regresses and 2 when it is right.
  check("the account view shows the source note once per card, not twice",
    flatMessages === ACCOUNTS, `found ${flatMessages} copies for ${ACCOUNTS} accounts`);
  check("the account view still shows the routed figures themselves",
    /routed 24h|routed 5h|routed 7d/.test(flat),
    "the figures were replaced by the message instead of sitting under it");

  // The figures were present and still rendered wrong: a no-limit row has no
  // `remaining`, the colour helper read that missing value as 0%, and a
  // perfectly healthy counter was painted red and marked as depleted — with
  // "Unlimited" printed twice on the row, once beside the count and again in
  // the column that exists to say it. Counting markers, rather than looking
  // for a red dot anywhere on the page, keeps this honest when a real
  // account's quota is genuinely low.
  const unlimitedCount = (flat.match(/Unlimited/g) || []).length;
  const infinityCount = (flat.match(/∞/g) || []).length;
  const usedCount = (flat.match(/ used/g) || []).length;
  check("a no-limit row is marked neutral, not as exhausted",
    unlimitedCount > 0 && infinityCount === unlimitedCount,
    `${infinityCount} neutral markers for ${unlimitedCount} no-limit rows`);
  check("...and says Unlimited once per row, not twice",
    unlimitedCount === usedCount,
    `${unlimitedCount} "Unlimited" across ${usedCount} rows`);

  // Attribute reads are not auto-waited the way actions are, so poll rather
  // than racing React's re-render.
  const untilAttr = async (locator, attr, value, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await locator.getAttribute(attr)) === value) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  check("the existing account view is still the default",
    await untilAttr(page.getByRole("button", { name: "By account" }), "aria-pressed", "true"),
    "By account should start selected, so the familiar view is what loads");

  await byProvider.click();
  check("clicking it selects the grouped view",
    await untilAttr(byProvider, "aria-pressed", "true"));

  const picker = page.getByLabel("Account for claude-cli");
  await picker.waitFor({ state: "visible", timeout: 30000 });
  check("a provider card with an account picker is drawn", true);

  const optionCount = await picker.locator("option").count();
  check("the picker lists every account of that provider", optionCount === ACCOUNTS,
    `options=${optionCount} expected=${ACCOUNTS}`);

  // One card per provider is the whole point — not one per account.
  const cardCount = await page.locator('select[aria-label^="Account for"]').count();
  check("one card per provider, not one per account", cardCount === 1,
    `cards=${cardCount} for ${ACCOUNTS} accounts of 1 provider`);

  // Picking the other account must actually change the selection.
  const values = await picker.locator("option").evaluateAll((os_) => os_.map((o) => o.value));
  await picker.selectOption(values[1]);
  check("choosing the other account switches the card to it",
    (await picker.inputValue()) === values[1],
    `value=${await picker.inputValue()}`);

  // These accounts report no upstream quota, so the card must say whose
  // numbers it is showing rather than implying a subscription limit.
  const bodyText = await page.locator("body").innerText();
  check("a provider with no upstream quota explains where its numbers came from",
    /Counted by 9Router|reports no/i.test(bodyText),
    bodyText.slice(0, 300));

  // Switching back must leave the original view intact.
  await page.getByRole("button", { name: "By account" }).click();
  check("switching back restores the account view",
    (await page.locator('select[aria-label^="Account for"]').count()) === 0,
    "grouped cards should be gone again");

  check("no client-side exception while using the view", pageErrors.length === 0,
    pageErrors.join(" | "));
} catch (e) {
  check("harness completed", false, e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

const pass = results.filter((r) => r.ok).length;
if (pass !== results.length) console.log(`\n--- server log tail ---\n${log.slice(-2000)}`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
