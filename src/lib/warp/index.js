// Cloudflare WARP hop engine: wgcf (account/profile) + wireproxy (userspace
// WireGuard exposed as an HTTP CONNECT proxy). Ported from openhop's zen_hop /
// warp_keeper — same idea, but the outbound identity lives in a wireproxy
// child process instead of the warp-cli system client, so it runs on any
// Linux box (Crostini/VPS) and in dev on Windows without the WARP app.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../dataDir.js";

// 40000 is WARP's own local-proxy default (warp-svc) — must not collide.
const PROXY_PORT = Number(process.env.WARP_PROXY_PORT) > 0 ? Number(process.env.WARP_PROXY_PORT) : 42901;
const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const READY_TIMEOUT_MS = 25 * 1000;
const HOP_COOLDOWN_MS = 45 * 1000;
const DEFAULT_MAX_HOPS = 3;

const dir = path.join(getDataDir(), "warp");
const binDir = path.join(dir, "bin");
const ACCOUNT_TOML = path.join(dir, "wgcf-account.toml");
const PROFILE_CONF = path.join(dir, "wgcf-profile.conf");
const WIREPROXY_CONF = path.join(dir, "wireproxy.conf");
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

// In-memory state, like connectionProxy's rotation state (resets on restart).
const state = { child: null, startedAt: null, hops: 0, lastHopAt: 0, lastIp: null, lastError: null, starting: null };

function log(tag, msg) {
  console.log(`${new Date().toISOString().slice(11, 23)} [WARP] ${tag} | ${msg}`);
}

function binName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

// Binary locations: env override first, then <DATA_DIR>/warp/bin (what
// scripts/warp-setup.sh downloads into).
function findBin(name) {
  const override = String(process.env[`WARP_${name.toUpperCase()}_PATH`] || "").trim();
  if (override && fs.existsSync(override)) return override;
  const p = path.join(binDir, binName(name));
  return fs.existsSync(p) ? p : null;
}

function ensureRuntime() {
  const wgcf = findBin("wgcf");
  const wireproxy = findBin("wireproxy");
  if (!wgcf || !wireproxy) {
    throw new Error(
      `wgcf/wireproxy binaries not found in ${binDir} — run scripts/warp-setup.sh once (or set WARP_WGCF_PATH / WARP_WIREPROXY_PATH)`
    );
  }
  return { wgcf, wireproxy };
}

function run(bin, args, timeoutMs = 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: dir, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch { }
      resolve({ code: 1, stdout: out, stderr: err || "timeout" });
    }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, stdout: out, stderr: String(e) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout: out, stderr: err }); });
  });
}

// Egress identity as seen by the internet: fetch the Cloudflare trace through
// the wireproxy HTTP proxy. Returns null while the tunnel is not ready.
async function warpTrace() {
  try {
    const { ProxyAgent, request } = await import("undici");
    const dispatcher = new ProxyAgent(PROXY_URL);
    const res = await request(TRACE_URL, { dispatcher, headersTimeout: 8000, bodyTimeout: 8000 });
    const text = await res.body.text();
    const kv = Object.fromEntries(text.split("\n").map((l) => l.split("=")).filter((p) => p.length === 2));
    return kv.warp === "on" || kv.warp === "plus" ? { ip: kv.ip || null, warp: kv.warp } : null;
  } catch {
    return null;
  }
}

async function waitReady(deadlineMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    // Our child exiting mid-wait (e.g. proxy port already bound by another
    // process) must fail fast, not ride a foreign listener to a fake success.
    if (!state.child) return null;
    const trace = await warpTrace();
    if (trace) return trace;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

// wgcf needs one Address line per family; its profile already carries both.
function writeWireproxyConf() {
  fs.writeFileSync(
    WIREPROXY_CONF,
    `WGConfig = ${PROFILE_CONF}\n\n[http]\nBindAddress = 127.0.0.1:${PROXY_PORT}\n`
  );
}

function spawnChild(wireproxy) {
  const child = spawn(wireproxy, ["-c", WIREPROXY_CONF, "-s"], { cwd: dir, windowsHide: true, stdio: "ignore" });
  child.on("exit", () => {
    if (state.child === child) {
      state.child = null;
      state.startedAt = null;
    }
  });
  state.child = child;
  state.startedAt = new Date().toISOString();
  return child;
}

// A crashed/restarted 9router leaves its wireproxy orphaned and still bound
// to our port, which would make every later start silently serve the OLD
// identity. Kill only processes whose command line carries OUR config path,
// so any foreign wireproxy instance survives.
async function killStaleWireproxy() {
  if (/['";`$]/.test(dir)) return; // odd data dir → skip rather than inject
  try {
    const { execFile } = await import("node:child_process");
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        execFile(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Get-CimInstance Win32_Process -Filter "Name='wireproxy.exe'" | ` +
              `Where-Object { $_.CommandLine -like '*${dir}*' } | ` +
              `ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
          ],
          { windowsHide: true },
          () => resolve()
        );
      });
    } else {
      await new Promise((resolve) => {
        execFile("pkill", ["-f", `${dir}/wireproxy.conf`], () => resolve());
      });
    }
  } catch { }
}

function stopChild() {
  const child = state.child;
  state.child = null;
  state.startedAt = null;
  if (!child) return;
  try { child.kill(); } catch { }
}

async function registerNewAccount() {
  // wgcf refuses to overwrite an existing account file; back it up so a
  // failed registration can restore the working /64 instead of leaving us
  // with no account at all.
  const backup = `${ACCOUNT_TOML}.bak`;
  const hadAccount = fs.existsSync(ACCOUNT_TOML);
  if (hadAccount) fs.copyFileSync(ACCOUNT_TOML, backup);
  if (fs.existsSync(ACCOUNT_TOML)) fs.rmSync(ACCOUNT_TOML);

  const { wgcf } = ensureRuntime();
  const reg = await run(wgcf, ["register", "--accept-tos"]);
  if (reg.code !== 0 || !fs.existsSync(ACCOUNT_TOML)) {
    if (hadAccount && fs.existsSync(backup)) {
      fs.copyFileSync(backup, ACCOUNT_TOML);
    }
    return { ok: false, error: (reg.stderr || reg.stdout || "wgcf register failed").trim().slice(0, 300) };
  }
  return { ok: true };
}

async function generateProfile() {
  const { wgcf } = ensureRuntime();
  const gen = await run(wgcf, ["generate"]);
  if (gen.code !== 0 || !fs.existsSync(PROFILE_CONF)) {
    return { ok: false, error: (gen.stderr || gen.stdout || "wgcf generate failed").trim().slice(0, 300) };
  }
  return { ok: true };
}

async function start() {
  const { wireproxy } = ensureRuntime();

  if (!fs.existsSync(ACCOUNT_TOML)) {
    const reg = await registerNewAccount();
    if (!reg.ok) throw new Error(`WARP registration failed: ${reg.error}`);
  }
  if (!fs.existsSync(PROFILE_CONF)) {
    const gen = await generateProfile();
    if (!gen.ok) throw new Error(`WARP profile generation failed: ${gen.error}`);
  }

  writeWireproxyConf();
  await killStaleWireproxy();
  spawnChild(wireproxy);
  const trace = await waitReady();
  if (!trace) {
    stopChild();
    throw new Error(`wireproxy tunnel not ready within ${READY_TIMEOUT_MS / 1000}s (port ${PROXY_PORT} in use? network blocked?)`);
  }
  state.lastIp = trace.ip;
  state.lastError = null;
  log("START", `tunnel up via ${PROXY_URL} | egress ${trace.ip}`);
  return trace;
}

// Single-flight so concurrent pool resolutions don't spawn two wireproxies.
export async function ensureStarted() {
  if (state.child) return true;
  if (state.starting) return await state.starting;
  state.starting = start()
    .then(() => true)
    .catch((e) => {
      state.lastError = String(e.message || e);
      log("START", `failed: ${state.lastError}`);
      return false;
    })
    .finally(() => { state.starting = null; });
  return await state.starting;
}

// Compare network blocks the way openhop does: IPv6 /64, IPv4 /24.
export function sameBlock(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(":") && b.includes(":")) {
    return a.split(":").slice(0, 4).join(":") === b.split(":").slice(0, 4).join(":");
  }
  if (!a.includes(":") && !b.includes(":")) {
    return a.split(".").slice(0, 3).join(".") === b.split(".").slice(0, 3).join(".");
  }
  return false;
}

/**
 * Rotate the outbound identity: kill wireproxy, register a fresh WARP
 * account (→ fresh IPv6 /64), regenerate the profile, restart the tunnel.
 * Cloudflare sometimes hands back the same block (openhop's keeper has the
 * same quirk), so retry the registration a couple of times. Returns
 * { ok, ip?, samePrefix?, error? }.
 */
export async function hop({ force = false, cooldownMs = HOP_COOLDOWN_MS } = {}) {
  if (!force && Date.now() - state.lastHopAt < cooldownMs) {
    return { ok: false, error: `cooldown (${Math.ceil((cooldownMs - (Date.now() - state.lastHopAt)) / 1000)}s)` };
  }
  state.lastHopAt = Date.now();
  stopChild();

  const oldIp = state.lastIp;
  let last = { ok: false, error: "no attempt" };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const reg = await registerNewAccount();
    if (!reg.ok) {
      last = { ok: false, error: reg.error };
      log("HOP", `registration failed: ${reg.error}`);
      break;
    }

    const gen = await generateProfile();
    if (!gen.ok) {
      last = { ok: false, error: gen.error };
      log("HOP", `profile generation failed: ${gen.error}`);
      break;
    }

    const { wireproxy } = ensureRuntime();
    writeWireproxyConf();
    await killStaleWireproxy();
    spawnChild(wireproxy);
    const trace = await waitReady();
    if (!trace) {
      last = { ok: false, error: "tunnel not ready after hop" };
      log("HOP", "tunnel not ready after hop");
      break;
    }

    state.hops += 1;
    state.lastIp = trace.ip;
    state.lastError = null;
    const fresh = !sameBlock(oldIp, trace.ip);
    last = { ok: true, ip: trace.ip, samePrefix: !fresh };
    if (fresh) {
      log("HOP", `egress ${oldIp || "?"} → ${trace.ip} (fresh block ✓)`);
      break;
    }
    log("HOP", `attempt ${attempt}/3 got the same block (${trace.ip}) — re-registering`);
  }

  if (!last.ok || last.samePrefix) {
    // Best effort: bring a working (old) identity back up instead of leaving
    // the pool pointed at a dead proxy.
    try { await start(); } catch { }
  }
  return last;
}

export async function stop() {
  stopChild();
  log("STOP", "wireproxy stopped");
}

export function getStatus() {
  return {
    running: !!state.child,
    pid: state.child?.pid || null,
    startedAt: state.startedAt,
    proxyUrl: PROXY_URL,
    hops: state.hops,
    lastHopAt: state.lastHopAt ? new Date(state.lastHopAt).toISOString() : null,
    lastIp: state.lastIp,
    lastError: state.lastError,
    dataDir: dir,
  };
}

// Errors that a fresh /64 can plausibly fix. 429 covers OpenCode Free's
// FreeUsageLimitError and generic rate limits; the text rules catch providers
// that phrase the limit without a 429.
export function isLimitLike(status, errorText) {
  if (status === 429) return true;
  const t = String(errorText || "").toLowerCase();
  return /usage limit|rate limit|too many requests/.test(t);
}

/**
 * Hook for the chat loop: did this request fail with a limit error on a
 * connection whose proxy pool is an active warp pool with autoHop on, and are
 * hops left for this request? If so, rotate the identity and tell the caller
 * to retry the same connection.
 */
export async function maybeHopRetry(credentials, result, hopsUsed) {
  const poolId = credentials?.providerSpecificData?.connectionProxyPoolId;
  if (!poolId) return false;

  const { getProxyPoolById } = await import("@/models");
  const pool = await getProxyPoolById(poolId).catch(() => null);
  if (!pool || pool.type !== "warp" || pool.isActive === false) return false;
  if (pool.autoHop === false) return false;

  const maxHops = Number(pool.maxHops) > 0 ? Number(pool.maxHops) : DEFAULT_MAX_HOPS;
  if (hopsUsed >= maxHops) return false;
  if (!isLimitLike(result?.status, result?.error)) return false;

  const name = credentials.connectionName || credentials.connectionId;
  log("HOP", `limit (${result.status}) on ${name}, hop ${hopsUsed + 1}/${maxHops}`);
  const r = await hop();
  return r.ok && !r.samePrefix;
}
