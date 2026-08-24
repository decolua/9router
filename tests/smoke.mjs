#!/usr/bin/env node
// End-to-end smoke test for the free-model auto-discovery feature.
//
// Default (offline): serves recorded upstream catalogs from
// tests/fixtures/free-sync/ on a local stub and points the app at it via
// FREE_MODEL_SYNC_FIXTURE_BASE, so a full sync runs with zero live traffic.
// `--live`: skips the stub and hits real upstreams (use before deploying).
//
// What it validates, against a spawned 9router server:
//   auth → free-sync status targets → settings enable round-trip →
//   POST run-now populates catalogs → /v1/models exposes alias/model for
//   connection-less noAuth providers → Free-All combo create + keep-in-sync
//   wiring → cleanup.
//
// Usage:
//   npm run qa           # dev server, offline fixtures
//   npm run qa:prod      # production build must exist (.next/standalone)
//   node tests/smoke.mjs --mode prod --live

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURES = join(__dirname, "fixtures", "free-sync");

const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const modeIdx = args.indexOf("--mode");
const MODE = modeIdx !== -1 && args[modeIdx + 1] === "prod" ? "prod" : "dev";

const PORT = Number(process.env.QA_PORT || 21401);
const FIXTURE_PORT = Number(process.env.QA_FIXTURE_PORT || 21402);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "qa-smoke-password";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not ready */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

// ─── Offline fixture stub ─────────────────────────────────────────────────────

const ROUTES = {
  "/zen/v1/models": "opencode-zen-models.json",
  "/api/v1/models": "openrouter-models.json",
  "/api.json": "models-dev.json",
};

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const hit = Object.keys(ROUTES).find((p) => req.url?.startsWith(p));
    if (!hit) {
      res.writeHead(404).end();
      return;
    }
    // OpenCode's anti-abuse gate keys off this header — assert the seam
    // forwards registry transport headers even in fixture mode.
    if (hit === "/zen/v1/models" && req.headers["x-opencode-client"] !== "desktop") {
      res.writeHead(403).end();
      return;
    }
    const body = readFileSync(join(FIXTURES, ROUTES[hit]));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, "127.0.0.1", () => resolve(server)));
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

function startAppServer(dataDir) {
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    INITIAL_PASSWORD: PASSWORD,
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    ...(LIVE ? {} : { FREE_MODEL_SYNC_FIXTURE_BASE: `http://127.0.0.1:${FIXTURE_PORT}` }),
  };
  // detached + negative-pid kill so the whole tree dies — `next dev` spawns a
  // child next-server that would otherwise outlive the wrapper and hold the port.
  const child =
    MODE === "prod"
      ? spawn("node", [join(ROOT, "custom-server.js"), "--port", String(PORT)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true })
      : spawn("npx", ["next", "dev", "--port", String(PORT)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  child.killTree = (signal = "SIGTERM") => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };
  return child;
}

async function assertPortFree(port, label) {
  const busy = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.once("error", () => resolve(true));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
  });
  if (busy) throw new Error(`port ${port} (${label}) is already in use — kill the stale process or set QA_${label === "app" ? "PORT" : "FIXTURE_PORT"}`);
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

let cookie = "";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}

// ─── Scenario ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`9router free-model smoke — mode=${MODE} live=${LIVE} port=${PORT}`);

  // Guard both ports BEFORE anything binds them.
  await assertPortFree(PORT, "app");
  if (!LIVE) await assertPortFree(FIXTURE_PORT, "fixture");

  // Fixture stub first so early sync ticks have something to hit.
  let fixtureServer = null;
  if (!LIVE) {
    fixtureServer = await startFixtureServer();
    console.log(`fixture stub on :${FIXTURE_PORT}`);
  }

  const dataDir = mkdtempSync(join(tmpdir(), "9r-smoke-"));
  const server = startAppServer(dataDir);

  let exitCode = 0;
  try {
    await waitFor(async () => {
      const r = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
      return r;
    }, MODE === "prod" ? 60000 : 120000, "app health");

    // 1. Login
    const login = await api("POST", "/api/auth/login", { password: PASSWORD });
    check("login succeeds", login.status === 200 && login.json?.success === true);

    // 2. Status exposes the expected sync targets
    const statusBefore = await api("GET", "/api/models/free-sync");
    const targetIds = (statusBefore.json?.targets || []).map((t) => t.id);
    check("status lists opencode target", targetIds.includes("opencode"));
    check("status lists openrouter target", targetIds.includes("openrouter"));
    check(
      "apikey-only providers are not targets",
      !targetIds.includes("venice") && !targetIds.includes("tokenrouter")
    );
    check("sync disabled by default", statusBefore.json?.config?.enabled === false);

    // 3. Enable via settings PATCH
    const patch = await api("PATCH", "/api/settings", {
      freeModelSync: { enabled: true, intervalHours: 4, autoComboIds: [] },
    });
    check("settings PATCH persists config", patch.json?.freeModelSync?.enabled === true);

    // 4. Run now (configures immediate tick; poll until catalogs land)
    await api("POST", "/api/models/free-sync");
    const done = await waitFor(async () => {
      const s = await api("GET", "/api/models/free-sync");
      return s.json?.running === false && Object.keys(s.json?.providers || {}).length > 0 ? s.json : null;
    }, 30000, "first sync pass");
    check("run-now populated catalogs", !!done, JSON.stringify(done?.lastError || ""));
    check("lastRunAt stamped", !!done?.lastRunAt);

    const counts = Object.fromEntries(Object.entries(done?.providers || {}).map(([k, v]) => [k, v.count]));
    check("openrouter catalog non-empty", (counts.openrouter || 0) > 0, `got ${counts.openrouter}`);
    check("opencode catalog has the -free set", (counts.opencode || 0) >= 8, `got ${counts.opencode}`);
    check("no sync error recorded", !done?.lastError, done?.lastError || "");

    // 5. /v1/models exposes connection-less noAuth frees
    const models = await api("GET", "/v1/models");
    const ids = (models.json?.data || []).map((m) => m.id);
    check("/v1/models reachable", models.status === 200 && ids.length > 0);
    check("oc/x-preview-f-free exposed", ids.includes("oc/x-preview-f-free"));
    check("oc/big-pickle exposed (known-free list)", ids.includes("oc/big-pickle"));
    check(
      "some openrouter :free exposed via openrouter alias",
      ids.some((id) => id.startsWith("openrouter/") && id.endsWith(":free"))
    );

    // 6. Free-All combo + keep-in-sync wiring
    const members = ids.filter((id) => id.startsWith("oc/") || (id.startsWith("openrouter/") && id.endsWith(":free")));
    const created = await api("POST", "/api/combos", { name: "Free-All-Smoke", models: members });
    check("combo created", created.status === 201 && !!created.json?.id);
    const comboId = created.json?.id;
    const wired = await api("PATCH", "/api/settings", {
      freeModelSync: { enabled: true, intervalHours: 8, autoComboIds: [comboId] },
    });
    check("autoComboIds persisted", wired.json?.freeModelSync?.autoComboIds?.[0] === comboId);

    // 7. Second sync rewrites the auto-combo deterministically
    await api("POST", "/api/models/free-sync");
    await sleep(1500);
    const combosAfter = await api("GET", "/api/combos");
    const freeAll = (combosAfter.json?.combos || []).find((c) => c.id === comboId);
    check("combo still present after re-sync", !!freeAll);
    check(
      "combo members refreshed from catalogs",
      Array.isArray(freeAll?.models) &&
        freeAll.models.length > 0 &&
        freeAll.models.every((m) => /^(oc|openrouter|mmf)\//.test(m)),
      `members=${freeAll?.models?.length}`
    );

    // 8. Cleanup state (best-effort; temp DATA_DIR is discarded anyway)
    await api("DELETE", `/api/combos/${comboId}`);
    await api("PATCH", "/api/settings", {
      freeModelSync: { enabled: false, intervalHours: 4, autoComboIds: [] },
    });
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  unexpected — ${err.message}`);
  } finally {
    server.killTree("SIGTERM");
    await sleep(1500);
    server.killTree("SIGKILL");
    fixtureServer?.close();
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* windows lock races */
    }
  }

  console.log(`\nsmoke result: ${passed} passed, ${failed} failed`);
  exitCode = failed > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
