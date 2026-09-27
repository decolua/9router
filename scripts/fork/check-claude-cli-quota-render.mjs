/**
 * The Claude Code CLI quota card, as it actually renders.
 *
 *   node scripts/fork/check-claude-cli-quota-render.mjs
 *
 * The report: every other provider's card shows a bar, a percentage and a reset
 * countdown, and this one showed none of them. check-claude-cli-quota-live.mjs
 * proves /api/usage returns the real windows; that is necessary and not
 * sufficient, because the complaint was about what is on the screen. So this
 * opens the page in a browser and reads the card.
 *
 * Deliberately one account and nothing else. The grouped-view check
 * (check-quota-view.mjs) needs several accounts and uses fabricated tokens,
 * which can only ever exercise the no-credential fallback; mixing the two made
 * a real-quota assertion there depend on unrelated rows.
 *
 * Needs the host to be signed in to Claude Code, a production build, and
 * playwright-core with a downloaded Chromium. Skips, rather than fails, when
 * any of those is missing.
 *
 * NOTE on TLS: where outbound HTTPS is intercepted (a corporate proxy with a
 * self-signed root), the upstream usage call fails and the server falls back to
 * routed counters, which this check reports as a FAIL. Run it as
 * `NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/fork/check-claude-cli-quota-render.mjs`
 * on such a machine — in the launching shell only, never in the app.
 *
 * Needs port 21996 free.
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
const PORT = 21996;
const PASSWORD = "claude-cli-render-password";
const DATA_DIR = path.join(os.tmpdir(), `9r-cli-render-${Date.now()}`);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};

const call = (opts, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, timeout: 180000, ...opts }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => {
      let json = null;
      try { json = JSON.parse(data); } catch { /* html */ }
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

const require_ = createRequire(import.meta.url);
let chromiumLauncher;
try {
  ({ chromium: chromiumLauncher } = require_(path.join(ROOT, "tests", "node_modules", "playwright-core")));
} catch {
  try { ({ chromium: chromiumLauncher } = require_("playwright-core")); } catch { /* handled below */ }
}
const executablePath = findChromium();
if (!chromiumLauncher || !executablePath) {
  console.log(`  SKIP  render check (${!chromiumLauncher
    ? "playwright-core not installed — cd tests && npm i -D playwright-core"
    : "no Chromium downloaded by Playwright on this machine"})`);
  process.exit(0);
}
if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
  console.log("  SKIP  render check (no production build — run `npx next build` first)");
  process.exit(0);
}

let server;
let browser;
let log = "";
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.JWT_SECRET;
  server = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT)], {
      cwd: ROOT,
      env: {
        ...env, DATA_DIR, INITIAL_PASSWORD: PASSWORD, PORT: String(PORT),
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
  const cookieOnly = { cookie: `auth_token=${token}` };
  const json = { ...cookieOnly, "content-type": "application/json" };

  const info = await call({ method: "GET", path: "/api/cli-tools/claude-cli-accounts", headers: cookieOnly });
  if (!info.json?.installed || !info.json?.host?.signedIn) {
    console.log("  SKIP  render check (needs Claude Code installed and signed in on this machine)");
    process.exit(0);
  }

  const adopted = await call({ method: "POST", path: "/api/cli-tools/claude-cli-accounts", headers: json },
    JSON.stringify({ adoptHost: true }));
  const id = adopted.json?.account?.id;
  check("the host's Claude Code account can be adopted", Boolean(id),
    `status=${adopted.status} body=${adopted.body.slice(0, 200)}`);
  if (!id) throw new Error("cannot continue without an account");

  browser = await chromiumLauncher.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: "auth_token", value: token, domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`http://127.0.0.1:${PORT}/dashboard/quota`, { waitUntil: "networkidle", timeout: 120000 });

  const bodyText = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  let text = "";
  try {
    await waitFor(async () => /session \(5h\)/.test(await bodyText()), 90000,
      "the subscription windows to render");
  } catch { /* asserted below, with the page as evidence */ }
  text = await bodyText();
  const evidence = text.slice(Math.max(0, text.indexOf("By account")), text.indexOf("By account") + 900);

  check("the card names the real subscription windows", /session \(5h\)/.test(text), evidence);
  check("...and the weekly window beside it", /weekly \(7d\)/.test(text), evidence);

  // The complaint, literally: no percentage and no time.
  check("...with a percentage, like every other provider",
    /\d+%/.test(text), evidence);
  check("...and a reset countdown, not N/A",
    /in \d+[dhm]/.test(text) && !/N\/A/.test(text), evidence);

  // A real window is graded, so it carries a health marker rather than the
  // neutral one used for figures that have no limit at all.
  check("...and a graded health marker, not the no-limit one",
    /🟢|🟡|🔴/.test(text) && !/∞/.test(text), evidence);

  // If the credential could not be resolved this silently becomes the fallback,
  // which looks plausible and is not what was asked for.
  check("the figures came from the subscription, not from counting routed calls",
    !/Counted by 9Router/.test(text) && !/routed 24h/.test(text), evidence);

  check("no client-side exception while rendering it", pageErrors.length === 0,
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
