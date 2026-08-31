/**
 * 9router config export/import/publish/receive — minimal auto migration.
 *
 * Keeps the useful SQLite config, leaves machine runtime junk behind.
 * No device key system, no merge rules: source package replaces target DB.
 */

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");

const DEFAULT_PORT = 20128;
const DEFAULT_HOST = "127.0.0.1";
const BUNDLE_NAME = "config.bundle";
const META_NAME = "meta.json";
const STATUS_NAME = "status.json";
const SYNC_CONFIG_FILE = "sync.json";

const HELP = `
Usage:
  9router config export [--out <path>] [--target <device>]
  9router config import --file <path> [--no-restart] [--port <port>] [--host <host>]
  9router config publish --target <device> [--repo <path>] [--file <path>]
  9router config receive [--repo <path>] [--once] [--daemon] [--interval <sec>] [--no-restart] [--port <port>]
  9router config status --target <device> [--repo <path>]
  9router config device-name

Export copies the live config DB (+ optional auth secrets) into a portable
bundle. Import backups the current DB, replaces it, restarts 9router, and
health-checks /v1/models. Publish/receive use a private git repo directory
as a dumb file drop for fully automatic cross-machine sync.
`;

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "9router")
    : path.join(os.homedir(), ".9router");
}

function dbPath() {
  return path.join(getDataDir(), "db", "data.sqlite");
}

function defaultDeviceName() {
  try {
    if (process.platform === "darwin") {
      return execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim() || os.hostname();
    }
  } catch {}
  return (os.hostname() || "device").replace(/\.local$/i, "");
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

function sha256File(file) {
  const h = createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function runSqliteBackup(srcDb, destDb) {
  ensureDir(path.dirname(destDb));
  if (!fs.existsSync(srcDb)) {
    throw new Error(`Config DB not found: ${srcDb}`);
  }
  // Prefer sqlite3 CLI: copies main DB + WAL into a clean standalone file.
  try {
    execFileSync("sqlite3", [srcDb, `.backup '${destDb.replace(/'/g, "''")}'`], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 60000,
    });
    return;
  } catch (err) {
    // Fallback: raw copy of main file only.
    fs.copyFileSync(srcDb, destDb);
    const msg = err?.stderr?.toString?.() || err.message;
    if (msg) console.warn(`⚠️  sqlite3 backup failed, used file copy: ${msg.trim()}`);
  }
}

function packagePaths(bundleDir) {
  return {
    dir: bundleDir,
    bundle: path.join(bundleDir, BUNDLE_NAME),
    meta: path.join(bundleDir, META_NAME),
  };
}

function isBundleDir(p) {
  return fs.existsSync(path.join(p, BUNDLE_NAME)) && fs.existsSync(path.join(p, META_NAME));
}

function resolveBundleDir(fileArg) {
  if (!fileArg) throw new Error("--file is required");
  const abs = path.resolve(fileArg);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && isBundleDir(abs)) return abs;
  if (fs.existsSync(abs) && path.basename(abs) === BUNDLE_NAME) {
    const dir = path.dirname(abs);
    if (isBundleDir(dir)) return dir;
  }
  throw new Error(`Not a 9router config bundle: ${abs}`);
}

function exportConfig(opts) {
  const outRoot = opts.out
    ? path.resolve(opts.out)
    : path.join(getDataDir(), "exports", `config-${stamp()}`);
  const paths = packagePaths(outRoot);
  ensureDir(paths.dir);

  runSqliteBackup(dbPath(), paths.bundle);

  const extra = [];
  for (const rel of ["jwt-secret", "auth/cli-secret"]) {
    const src = path.join(getDataDir(), rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(paths.dir, path.basename(rel));
    fs.copyFileSync(src, dest);
    try { fs.chmodSync(dest, 0o600); } catch {}
    extra.push(path.basename(rel));
  }

  const meta = {
    kind: "9router-config",
    version: 1,
    createdAt: new Date().toISOString(),
    sourceDevice: defaultDeviceName(),
    targetDevice: opts.target || null,
    sourceHostname: os.hostname(),
    dbSha256: sha256File(paths.bundle),
    files: [BUNDLE_NAME, ...extra],
    note: "Replace target DB with this bundle. Runtime cache/logs are not included.",
  };
  writeJson(paths.meta, meta);
  try { fs.chmodSync(paths.bundle, 0o600); } catch {}

  console.log(`✅ Exported config → ${paths.dir}`);
  console.log(`   DB: ${paths.bundle}`);
  if (opts.target) console.log(`   Target: ${opts.target}`);
  return paths.dir;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitPort(port, host, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get({ host, port, path: "/v1/models", timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode < 500);
      });
      req.on("error", () => {
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tryOnce, 250);
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

function healthCheck(port, host) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/v1/models", timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 500,
          status: res.statusCode,
          bytes: body.length,
        });
      });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

function killRunningRouter(port) {
  // Best-effort: free the port before swapping DB.
  try {
    if (process.platform === "win32") {
      execFileSync("powershell", [
        "-NonInteractive",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      ], { stdio: "ignore", timeout: 8000 });
      return;
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8", timeout: 5000 }).trim();
    if (!out) return;
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      try { process.kill(parseInt(pid, 10), "SIGKILL"); } catch {}
    }
  } catch {
    // nothing listening
  }
}

function startRouterBackground({ port, host }) {
  const cliJs = path.resolve(__dirname, "../../../cli.js");
  const child = spawn(process.execPath, [cliJs, "--tray", "--skip-update", "--host", host, "--port", String(port)], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  return child.pid;
}

async function importConfig(opts) {
  const bundleDir = resolveBundleDir(opts.file);
  const paths = packagePaths(bundleDir);
  const meta = readJson(paths.meta, {});
  if (meta.kind && meta.kind !== "9router-config") {
    throw new Error(`Unsupported bundle kind: ${meta.kind}`);
  }
  if (meta.dbSha256) {
    const actual = sha256File(paths.bundle);
    if (actual !== meta.dbSha256) {
      throw new Error(`Bundle checksum mismatch (expected ${meta.dbSha256}, got ${actual})`);
    }
  }

  const dataDir = getDataDir();
  const liveDb = dbPath();
  const backupDir = ensureDir(path.join(dataDir, "db", "backups"));
  const backupPath = path.join(backupDir, `data.sqlite.bak-${stamp()}`);

  if (fs.existsSync(liveDb)) {
    runSqliteBackup(liveDb, backupPath);
    console.log(`📦 Backup → ${backupPath}`);
  } else {
    ensureDir(path.dirname(liveDb));
  }

  const port = opts.port || DEFAULT_PORT;
  const host = opts.host || DEFAULT_HOST;
  killRunningRouter(port);
  await sleep(500);

  // Replace live DB (+ wipe WAL/SHM so sqlite doesn't revive old state).
  fs.copyFileSync(paths.bundle, liveDb);
  try { fs.chmodSync(liveDb, 0o600); } catch {}
  for (const suffix of ["-wal", "-shm"]) {
    const p = liveDb + suffix;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }

  for (const name of ["jwt-secret", "cli-secret"]) {
    const src = path.join(bundleDir, name);
    if (!fs.existsSync(src)) continue;
    const dest = name === "cli-secret"
      ? path.join(dataDir, "auth", "cli-secret")
      : path.join(dataDir, name);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    try { fs.chmodSync(dest, 0o600); } catch {}
  }

  if (opts.noRestart) {
    console.log("✅ Imported config (service not restarted)");
    return { ok: true, restarted: false, backupPath };
  }

  const pid = startRouterBackground({ port, host });
  console.log(`🔄 Restarting 9router (pid ${pid || "?"}) on ${host}:${port}...`);
  const ready = await waitPort(port, host, 90000);
  if (!ready) {
    // Rollback
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, liveDb);
      for (const suffix of ["-wal", "-shm"]) {
        const p = liveDb + suffix;
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
      }
      killRunningRouter(port);
      startRouterBackground({ port, host });
      console.error("❌ Health wait failed; restored backup and restarted previous config");
      return { ok: false, restarted: true, backupPath, rolledBack: true };
    }
    throw new Error("Import applied but 9router did not become ready");
  }

  const health = await healthCheck(port, host);
  if (!health.ok) {
    if (fs.existsSync(backupPath)) {
      killRunningRouter(port);
      await sleep(300);
      fs.copyFileSync(backupPath, liveDb);
      for (const suffix of ["-wal", "-shm"]) {
        const p = liveDb + suffix;
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
      }
      startRouterBackground({ port, host });
      console.error(`❌ Health check failed (${health.error || health.status}); restored backup`);
      return { ok: false, restarted: true, backupPath, rolledBack: true, health };
    }
    throw new Error(`Health check failed: ${health.error || health.status}`);
  }

  console.log(`✅ Imported config and verified /v1/models (HTTP ${health.status})`);
  if (meta.sourceDevice) console.log(`   From: ${meta.sourceDevice}`);
  return { ok: true, restarted: true, backupPath, health };
}

function syncConfigPath() {
  return path.join(getDataDir(), SYNC_CONFIG_FILE);
}

function readSyncConfig() {
  return readJson(syncConfigPath(), {});
}

function resolveSyncRepo(repoArg) {
  // Priority: --repo flag > env > ~/.9router/sync.json > default on this machine.
  const fromFile = readSyncConfig();
  const repo =
    repoArg ||
    process.env.NINE_ROUTER_SYNC_REPO ||
    fromFile.repo ||
    "";
  if (!repo) {
    throw new Error(
      "Sync repo required: pass --repo, set NINE_ROUTER_SYNC_REPO, or write ~/.9router/sync.json {\"repo\":\"<path>\"}"
    );
  }
  const abs = path.resolve(repo);
  if (!fs.existsSync(abs)) throw new Error(`Sync repo not found: ${abs}`);
  return abs;
}

function migrationRoot(repo) {
  return path.join(repo, "private", "9router-migrations");
}

function targetDir(repo, target) {
  return path.join(migrationRoot(repo), target);
}

function git(repo, args, opts = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: opts.stdio || ["ignore", "pipe", "pipe"],
    timeout: opts.timeout || 120000,
  });
}

function gitAvailable(repo) {
  try {
    git(repo, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

function copyBundle(srcDir, destDir) {
  ensureDir(destDir);
  const src = packagePaths(srcDir);
  const dest = packagePaths(destDir);
  fs.copyFileSync(src.bundle, dest.bundle);
  fs.copyFileSync(src.meta, dest.meta);
  for (const name of ["jwt-secret", "cli-secret"]) {
    const p = path.join(srcDir, name);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(destDir, name));
  }
  try { fs.chmodSync(dest.bundle, 0o600); } catch {}
  return destDir;
}

function publishConfig(opts) {
  if (!opts.target) throw new Error("--target is required");
  const repo = resolveSyncRepo(opts.repo);
  if (!gitAvailable(repo)) throw new Error(`Not a git repo: ${repo}`);

  const exported = opts.file
    ? resolveBundleDir(opts.file)
    : exportConfig({ target: opts.target });

  // Pull latest first to reduce push races.
  try { git(repo, ["pull", "--ff-only"]); } catch (err) {
    console.warn(`⚠️  git pull skipped/failed: ${(err.stderr || err.message || "").toString().trim()}`);
  }

  const dest = targetDir(repo, opts.target);
  copyBundle(exported, dest);
  const meta = readJson(packagePaths(dest).meta, {});
  meta.targetDevice = opts.target;
  meta.publishedAt = new Date().toISOString();
  writeJson(packagePaths(dest).meta, meta);
  writeJson(path.join(dest, STATUS_NAME), {
    state: "pending",
    target: opts.target,
    sourceDevice: meta.sourceDevice || defaultDeviceName(),
    updatedAt: new Date().toISOString(),
    message: "Waiting for target receive",
  });

  const rel = path.relative(repo, dest);
  git(repo, ["add", "-A", "--", rel]);
  const status = git(repo, ["status", "--porcelain", "--", rel]).trim();
  if (status) {
    git(repo, ["commit", "-m", `chore(9router): publish config to ${opts.target}`]);
    try {
      git(repo, ["push"]);
    } catch (err) {
      throw new Error(`git push failed: ${(err.stderr || err.message || "").toString().trim()}`);
    }
  }

  console.log(`✅ Published config for ${opts.target}`);
  console.log(`   Repo path: ${dest}`);
  return dest;
}

async function receiveConfig(opts) {
  const repo = resolveSyncRepo(opts.repo);
  if (!gitAvailable(repo)) throw new Error(`Not a git repo: ${repo}`);
  const device = opts.device || defaultDeviceName();
  const dest = targetDir(repo, device);

  try { git(repo, ["pull", "--ff-only"]); } catch (err) {
    console.warn(`⚠️  git pull failed: ${(err.stderr || err.message || "").toString().trim()}`);
  }
  if (!isBundleDir(dest)) {
    console.log(`ℹ️  No pending config for device "${device}"`);
    return { ok: true, applied: false };
  }

  const status = readJson(path.join(dest, STATUS_NAME), {});
  if (status.state === "applied" && status.dbSha256) {
    const current = sha256File(packagePaths(dest).bundle);
    if (status.dbSha256 === current) {
      console.log(`ℹ️  Latest config already applied for "${device}"`);
      return { ok: true, applied: false, already: true };
    }
  }
  // A crashed previous run leaves state "applying" — treat as retryable.
  if (status.state === "applying") {
    console.log(`↻ Previous receive was interrupted; retrying for "${device}"`);
  }

  writeJson(path.join(dest, STATUS_NAME), {
    state: "applying",
    target: device,
    updatedAt: new Date().toISOString(),
    message: "Import in progress",
  });
  try {
    git(repo, ["add", "-A", "--", path.relative(repo, dest)]);
    if (git(repo, ["status", "--porcelain", "--", path.relative(repo, dest)]).trim()) {
      git(repo, ["commit", "-m", `chore(9router): receiving config on ${device}`]);
      try { git(repo, ["push"]); } catch {}
    }
  } catch {}

  const result = await importConfig({
    file: dest,
    noRestart: opts.noRestart,
    port: opts.port,
    host: opts.host,
  });

  const meta = readJson(packagePaths(dest).meta, {});
  const nextStatus = {
    state: result.ok ? "applied" : "failed",
    target: device,
    sourceDevice: meta.sourceDevice || null,
    updatedAt: new Date().toISOString(),
    message: result.ok
      ? (result.rolledBack ? "Failed health check; rolled back" : "Imported and verified")
      : "Import failed",
    dbSha256: meta.dbSha256 || null,
    backupPath: result.backupPath || null,
    rolledBack: !!result.rolledBack,
  };
  writeJson(path.join(dest, STATUS_NAME), nextStatus);

  // After success, drop secrets from the shared drop folder but keep status for polling.
  if (result.ok && !result.rolledBack) {
    for (const name of [BUNDLE_NAME, "jwt-secret", "cli-secret"]) {
      const p = path.join(dest, name);
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
  }

  const rel = path.relative(repo, dest);
  git(repo, ["add", "-A", "--", rel]);
  if (git(repo, ["status", "--porcelain", "--", rel]).trim()) {
    git(repo, ["commit", "-m", `chore(9router): ${nextStatus.state} config on ${device}`]);
    try { git(repo, ["push"]); } catch (err) {
      console.warn(`⚠️  status push failed: ${(err.stderr || err.message || "").toString().trim()}`);
    }
  }

  // On failure the bundle stays in place (with a "failed" status committed
  // above) so the next cycle retries the import automatically.
  if (!result.ok) {
    console.error(`❌ Receive failed for ${device}`);
    return { ok: false, applied: true, ...result };
  }
  console.log(`✅ Received and applied config for ${device}`);
  return { ok: true, applied: true, ...result };
}

async function runDaemonLoop(opts) {
  const intervalSec = Math.max(15, opts.intervalSec || 60);
  console.log(`🔁 9router config receive daemon: polling every ${intervalSec}s`);
  console.log(`   Device: ${opts.device || defaultDeviceName()}`);
  let lastSha = null;
  for (;;) {
    try {
      const r = await receiveConfig(opts);
      if (r?.ok && r?.applied) lastSha = r.dbSha || null;
    } catch (err) {
      console.error(`⚠️  receive cycle failed: ${err?.message || err}`);
    }
    await sleep(intervalSec * 1000);
  }
}

function statusConfig(opts) {
  if (!opts.target) throw new Error("--target is required");
  const repo = resolveSyncRepo(opts.repo);
  try { git(repo, ["pull", "--ff-only"]); } catch {}
  const statusPath = path.join(targetDir(repo, opts.target), STATUS_NAME);
  const status = readJson(statusPath, null);
  if (!status) {
    console.log(`ℹ️  No status for ${opts.target}`);
    return null;
  }
  console.log(JSON.stringify(status, null, 2));
  return status;
}

function parseArgs(argv) {
  const opts = {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    once: false,
    noRestart: false,
  };
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
    opts.help = true;
    opts.action = "help";
    return opts;
  }
  opts.action = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--out" || a === "-o") opts.out = next();
    else if (a === "--file" || a === "-f") opts.file = next();
    else if (a === "--target") opts.target = next();
    else if (a === "--repo") opts.repo = next();
    else if (a === "--device") opts.device = next();
    else if (a === "--interval" || a === "-i") opts.intervalSec = parseInt(next(), 10);
    else if (a === "--port" || a === "-p") opts.port = parseInt(next(), 10) || DEFAULT_PORT;
    else if (a === "--host" || a === "-H") opts.host = next() || DEFAULT_HOST;
    else if (a === "--once") opts.once = true;
    else if (a === "--no-restart") opts.noRestart = true;
    else if (a === "--daemon") opts.daemon = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help || opts.action === "help") {
    console.log(HELP.trim());
    return 0;
  }
  switch (opts.action) {
    case "export":
      exportConfig(opts);
      return 0;
    case "import":
      if (!opts.file) throw new Error("--file is required");
      {
        const r = await importConfig(opts);
        return r.ok ? 0 : 2;
      }
    case "publish":
      publishConfig(opts);
      return 0;
    case "receive":
      if (opts.daemon) {
        await runDaemonLoop(opts);
        return 0;
      }
      {
        const r = await receiveConfig(opts);
        return r.ok ? 0 : 2;
      }
    case "status":
      statusConfig(opts);
      return 0;
    case "device-name":
      console.log(defaultDeviceName());
      return 0;
    default:
      throw new Error(`Unknown config action: ${opts.action}\n${HELP}`);
  }
}

module.exports = {
  run,
  parseArgs,
  exportConfig,
  importConfig,
  publishConfig,
  receiveConfig,
  defaultDeviceName,
  getDataDir,
};
