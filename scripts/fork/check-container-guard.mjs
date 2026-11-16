/**
 * Reproduce "Local only: CLI token required", then prove the container fix.
 *
 *   node scripts/fork/check-container-guard.mjs
 *
 * Both provider cards call routes in LOCAL_ONLY_PATHS, which upstream gates on
 * the request coming from the machine running 9Router. In Docker or Kubernetes
 * that is never true — the dashboard is reached through an Ingress — so both
 * cards answered "Local only: CLI token required" and nothing could be
 * configured. src/dashboardGuard.js now treats authentication as the whole
 * gate when it can see it is in a container.
 *
 * The simulation is faithful rather than approximate: an Ingress forwards with
 * `X-Forwarded-For`, and custom-server.js stamps `x-9r-via-proxy` whenever a
 * forwarding header is present, which is exactly what makes isLocalRequest()
 * return false. So sending XFF over loopback produces the same guard decision a
 * real remote browser does.
 *
 * IS_CONTAINER is evaluated once at module load, so this boots the server
 * twice: once as a plain host (expect the failure) and once with
 * KUBERNETES_SERVICE_HOST set, as every pod has (expect it to work).
 *
 * Note: booting `next dev` makes Next re-add its agent-rules block to
 * CLAUDE.md. That is expected and not this script's doing — `git checkout --
 * CLAUDE.md` afterwards, or upgrade-fork.mjs will refuse the dirty tree.
 *
 * Takes a few minutes, needs port 21994 free, touches no real 9Router state.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = process.env.ROUTER_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 21994;
const PASSWORD = "container-guard-test-password";

// Both cards, both gated.
const ROUTES = [
  ["Claude Code card", "/api/cli-tools/claude-cli-accounts"],
];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};

const call = (opts, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, timeout: 120000, ...opts }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
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

/** Boot next dev with the wrapper loaded, run `body`, then shut it down. */
async function withServer(extraEnv, body) {
  const dataDir = path.join(os.tmpdir(), `9r-guard-${Date.now()}`);
  fs.mkdirSync(dataDir, { recursive: true });
  const env = { ...process.env };
  delete env.JWT_SECRET;
  delete env.KUBERNETES_SERVICE_HOST;
  delete env.NINEROUTER_HOST_ROUTES_REMOTE;

  const server = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", "--port", String(PORT)], {
      cwd: ROOT,
      env: {
        ...env,
        ...extraEnv,
        DATA_DIR: dataDir,
        INITIAL_PASSWORD: PASSWORD,
        // NODE_OPTIONS is parsed shell-style: quote the spaced path, forward
        // slashes because backslashes read as escapes.
        NODE_OPTIONS: `--require "${path.join(ROOT, "custom-server.js").replace(/\\/g, "/")}"`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });

  try {
    await waitFor(async () => (await call({ method: "GET", path: "/api/health" })).status < 500,
      180000, "next dev to answer");
    const login = await call({ method: "POST", path: "/api/auth/login", headers: { "content-type": "application/json" } },
      JSON.stringify({ password: PASSWORD }));
    const m = /auth_token=([^;]+)/.exec([].concat(login.headers["set-cookie"] || []).join("; "));
    if (!m) throw new Error(`login failed: ${login.status} ${login.body.slice(0, 120)}`);
    return await body(`auth_token=${m[1]}`, log);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 1500));
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// A request as it arrives from an Ingress: forwarded, so not "local".
const asRemoteBrowser = (cookie) => ({
  cookie,
  "x-forwarded-for": "203.0.113.10",
  host: "9router.example.com",
  origin: "https://9router.example.com",
});

console.log("── 1/2  plain host: the failure the cards actually showed");
await withServer({}, async (cookie) => {
  for (const [label, route] of ROUTES) {
    const res = await call({ method: "GET", path: route, headers: asRemoteBrowser(cookie) });
    let msg = "";
    try { msg = JSON.parse(res.body).error || ""; } catch { msg = res.body.slice(0, 120); }
    check(`${label}: forwarded request is refused off-host`,
      res.status === 403 && /Local only/i.test(msg),
      `status=${res.status} error=${msg}`);
  }
  // The same request without forwarding headers is genuinely local, and works.
  const local = await call({ method: "GET", path: ROUTES[0][1], headers: { cookie, host: "127.0.0.1" } });
  check("a genuinely local request is still allowed", local.status === 200, `status=${local.status}`);
});

console.log("\n── 2/2  in a pod (KUBERNETES_SERVICE_HOST set): the fix");
await withServer({ KUBERNETES_SERVICE_HOST: "10.96.0.1" }, async (cookie) => {
  for (const [label, route] of ROUTES) {
    const res = await call({ method: "GET", path: route, headers: asRemoteBrowser(cookie) });
    check(`${label}: same forwarded request now works`, res.status === 200,
      `status=${res.status} body=${res.body.slice(0, 160)}`);
  }
  // Authentication has to remain the gate — not "container means open".
  const anon = await call({
    method: "GET",
    path: ROUTES[0][1],
    headers: { "x-forwarded-for": "203.0.113.10", host: "9router.example.com" },
  });
  let msg = "";
  try { msg = JSON.parse(anon.body).error || ""; } catch { msg = anon.body.slice(0, 120); }
  check("an unauthenticated request is still refused in a container",
    anon.status === 403, `status=${anon.status} error=${msg}`);
});

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
