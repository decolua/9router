const cp = require("child_process");
const { exec } = cp;
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const https = require("https");
const crypto = require("crypto");
const { addDNSEntry, removeDNSEntry, checkDNSEntry } = require("./dns/dnsConfig");

const IS_WIN = process.platform === "win32";
const { generateCert } = require("./cert/generate");
const { installCert } = require("./cert/install");

const MITM_PORT = 443;
const PID_FILE = path.join(os.homedir(), ".9router", "mitm", ".mitm.pid");

// Resolve server.js path robustly:
// __dirname is unreliable inside Next.js bundles, so we use DATA_DIR env or
// fall back to locating the file relative to the app's source root.
function resolveServerPath() {
  // 1. Explicit override via env (useful for packaged/standalone builds)
  if (process.env.MITM_SERVER_PATH) return process.env.MITM_SERVER_PATH;

  // 2. Try sibling of this file (works in dev where __dirname is real)
  const sibling = path.join(__dirname, "server.js");
  if (fs.existsSync(sibling)) return sibling;

  // 3. Fallback: resolve from process.cwd() → src/mitm/server.js
  const fromCwd = path.join(process.cwd(), "src", "mitm", "server.js");
  if (fs.existsSync(fromCwd)) return fromCwd;

  // 4. Standalone build: app root is parent of .next
  const fromNext = path.join(process.cwd(), "..", "src", "mitm", "server.js");
  if (fs.existsSync(fromNext)) return fromNext;

  return fromCwd; // best guess
}

const SERVER_PATH = resolveServerPath();

const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "9router-mitm-pwd";

// Store server process in-memory
let serverProcess = null;
let serverPid = null;

// Persist sudo password across Next.js hot reloads (in-memory only)
function getCachedPassword() { return globalThis.__mitmSudoPassword || null; }
function setCachedPassword(pwd) { globalThis.__mitmSudoPassword = pwd; }

// Check if a PID is alive
// EACCES = process exists but no permission (e.g. root process) → still alive
// ESRCH  = process does not exist → dead
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EACCES";
  }
}

// Cross-platform process kill
function killProcess(pid, force = false) {
  if (IS_WIN) {
    const flag = force ? "/F " : "";
    exec(`taskkill ${flag}/PID ${pid}`, () => { });
  } else {
    // Use pkill to kill entire process group (catches sudo + child node process)
    const sig = force ? "SIGKILL" : "SIGTERM";
    exec(`pkill -${sig} -P ${pid} 2>/dev/null; kill -${sig} ${pid} 2>/dev/null`, () => { });
  }
}

/** Derive a 32-byte encryption key from machineId */
function deriveKey() {
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + ENCRYPT_SALT).digest();
  } catch {
    // Fallback: fixed key derived from salt (less secure but functional)
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

/** Encrypt sudo password with AES-256-GCM */
function encryptPassword(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as hex: iv:tag:ciphertext
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt sudo password */
function decryptPassword(stored) {
  try {
    const [ivHex, tagHex, dataHex] = stored.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
  } catch {
    return null;
  }
}

// DB hooks — injected from ESM context (initializeApp / route handlers)
// to avoid webpack bundling issues with dynamic imports in CJS modules.
let _getSettings = null;
let _updateSettings = null;

/** Called once from ESM context to inject DB access functions */
function initDbHooks(getSettingsFn, updateSettingsFn) {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

/** Save encrypted sudo password + mitmEnabled to db */
async function saveMitmSettings(enabled, password) {
  if (!_updateSettings) {
    console.log("[MITM] DB hooks not initialized, skipping save");
    return;
  }
  try {
    const updates = { mitmEnabled: enabled };
    if (password) updates.mitmSudoEncrypted = encryptPassword(password);
    await _updateSettings(updates);
  } catch (e) {
    console.log("[MITM] Failed to save settings:", e.message);
  }
}

/** Load and decrypt sudo password from db */
async function loadEncryptedPassword() {
  if (!_getSettings) return null;
  try {
    const settings = await _getSettings();
    if (!settings.mitmSudoEncrypted) return null;
    return decryptPassword(settings.mitmSudoEncrypted);
  } catch {
    return null;
  }
}

/**
 * Check if port 443 is available
 * Returns: "free" | "in-use" | "no-permission"
 */
function checkPort443Free() {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve("in-use");
      else resolve("no-permission"); // EACCES or other → port free but needs sudo
    });
    tester.once("listening", () => { tester.close(() => resolve("free")); });
    tester.listen(MITM_PORT, "127.0.0.1");
  });
}

/**
 * Get PID and process name currently holding port 443
 * Returns { pid, name } or null if port is free / cannot determine
 */
function getPort443Owner(sudoPassword) {
  return new Promise((resolve) => {
    if (IS_WIN) {
      exec(`netstat -ano | findstr ":443 "`, (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        for (const line of stdout.split("\n")) {
          const match = line.match(/LISTENING\s+(\d+)/i);
          if (match) {
            const pid = parseInt(match[1], 10);
            exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (e2, out2) => {
              const m = out2?.match(/"([^"]+)"/);
              resolve({ pid, name: m ? m[1] : "unknown" });
            });
            return;
          }
        }
        resolve(null);
      });
    } else {
      // Use ps to find node process running server.js (no sudo needed)
      exec(`ps aux | grep "[s]erver.js"`, (err, stdout) => {
        if (!stdout?.trim()) return resolve(null);
        for (const line of stdout.split("\n")) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[1], 10);
          if (!isNaN(pid)) return resolve({ pid, name: "node" });
        }
        resolve(null);
      });
    }
  });
}

/**
 * Kill any leftover MITM server process (from previous failed start)
 * Uses sudo to kill the node process that was spawned with sudo
 */
async function killLeftoverMitm(sudoPassword) {
  // Kill in-memory process if still alive
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill("SIGKILL"); } catch { /* ignore */ }
    serverProcess = null;
    serverPid = null;
  }

  // Kill from PID file
  try {
    if (fs.existsSync(PID_FILE)) {
      const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (savedPid && isProcessAlive(savedPid)) {
        killProcess(savedPid, true);
        await new Promise(r => setTimeout(r, 500));
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch { /* ignore */ }

  // Also kill any node process running server.js via sudo (belt-and-suspenders)
  if (!IS_WIN && SERVER_PATH) {
    try {
      const escaped = SERVER_PATH.replace(/'/g, "'\\''");
      if (sudoPassword) {
        const { execWithPassword } = require("./dns/dnsConfig");
        await execWithPassword(`pkill -SIGKILL -f "${escaped}" 2>/dev/null || true`, sudoPassword).catch(() => { });
      } else {
        exec(`pkill -SIGKILL -f "${escaped}" 2>/dev/null || true`, () => { });
      }
      await new Promise(r => setTimeout(r, 500));
    } catch { /* ignore */ }
  }
}

/**
 * Poll MITM health endpoint until server is up or timeout.
 * Returns { ok, pid } on success, null on timeout.
 */
function pollMitmHealth(timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = https.request(
        { hostname: "127.0.0.1", port: 443, path: "/_mitm_health", method: "GET", rejectUnauthorized: false },
        (res) => {
          let body = "";
          res.on("data", (d) => { body += d; });
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              resolve(json.ok === true ? { ok: true, pid: json.pid || null } : null);
            } catch { resolve(null); }
          });
        }
      );
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(check, 500);
        else resolve(null);
      });
      req.end();
    };
    check();
  });
}

/**
 * Get MITM status
 */
async function getMitmStatus() {
  let running = serverProcess !== null && !serverProcess.killed;
  let pid = serverPid;

  if (!running) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          running = true;
          pid = savedPid;
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch {
      // Ignore
    }
  }

  const dnsConfigured = checkDNSEntry();
  const certDir = path.join(os.homedir(), ".9router", "mitm");
  const certExists = fs.existsSync(path.join(certDir, "server.crt"));

  return { running, pid, dnsConfigured, certExists };
}

/**
 * Start MITM proxy
 * @param {string} apiKey - 9Router API key
 * @param {string} sudoPassword - Sudo password for DNS/cert operations
 */
async function startMitm(apiKey, sudoPassword) {
  // Check orphan process from PID file before spawning
  if (!serverProcess || serverProcess.killed) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          // Orphan MITM process still alive — reuse it
          serverPid = savedPid;
          console.log(`[MITM] Reusing existing process PID ${savedPid}`);
          await saveMitmSettings(true, sudoPassword);
          if (sudoPassword) setCachedPassword(sudoPassword);
          return { running: true, pid: savedPid };
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch {
      // Ignore stale PID file errors
    }
  }

  if (serverProcess && !serverProcess.killed) {
    throw new Error("MITM proxy is already running");
  }

  // Kill any leftover MITM server from a previous failed start attempt
  await killLeftoverMitm(sudoPassword);

  // Check port 443 availability BEFORE modifying system
  // "no-permission" = EACCES: port may be held by a root process, check via lsof/netstat
  const portStatus = await checkPort443Free();
  if (portStatus === "in-use" || portStatus === "no-permission") {
    const owner = await getPort443Owner(sudoPassword);
    if (owner && owner.name === "node") {
      // Orphan MITM node process — kill it and continue
      console.log(`[MITM] Killing orphan node process on port 443 (PID ${owner.pid})...`);
      try {
        if (IS_WIN) {
          await new Promise((resolve) => exec(`taskkill /F /PID ${owner.pid}`, resolve));
        } else {
          const { execWithPassword } = require("./dns/dnsConfig");
          await execWithPassword(`kill -9 ${owner.pid}`, sudoPassword);
        }
        await new Promise(r => setTimeout(r, 800));
      } catch {
        // best effort — continue anyway
      }
    } else if (owner) {
      const shortName = owner.name.includes("/")
        ? owner.name.split("/").filter(Boolean).pop()
        : owner.name;
      throw new Error(
        `Port 443 is already in use by "${shortName}" (PID ${owner.pid}). Stop that process first, then retry.`
      );
    }
    // owner === null + no-permission → likely just needs sudo, proceed
  }

  // 1. Generate SSL certificate if not exists
  const certPath = path.join(os.homedir(), ".9router", "mitm", "server.crt");
  if (!fs.existsSync(certPath)) {
    console.log("Generating SSL certificate...");
    await generateCert();
  }

  // 2. Install certificate to system keychain
  // Skip if db flag says installed AND cert file still exists (same cert in keychain)
  const settings = _getSettings ? await _getSettings().catch(() => ({})) : {};
  const certAlreadyInstalled = settings.mitmCertInstalled && fs.existsSync(certPath);
  if (!certAlreadyInstalled) {
    await installCert(sudoPassword, certPath);
    if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });
  }

  // 3. Add DNS entry
  console.log("Adding DNS entry...");
  await addDNSEntry(sudoPassword);

  // 4. Spawn MITM server with sudo (port 443 requires root on macOS/Linux)
  console.log("Starting MITM server...");

  if (IS_WIN) {
    // Use cmd /c to set env vars inline before launching node (env vars survive RunAs)
    const nodePath = process.execPath.replace(/"/g, '\\"');
    const serverPath = SERVER_PATH.replace(/"/g, '\\"');
    const cmdLine = `set ROUTER_API_KEY=${apiKey}&& set NODE_ENV=production&& "${nodePath}" "${serverPath}"`;
    serverProcess = spawn("powershell", [
      "-NoProfile", "-Command",
      `Start-Process cmd -ArgumentList '/c','${cmdLine.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden`
    ], { stdio: "ignore" });
  } else {
    // sudo -S: read password from stdin, -E: preserve env vars
    // Pass ROUTER_API_KEY inline via env=... wrapper to avoid sudo stripping env
    const inlineCmd = `ROUTER_API_KEY='${apiKey}' NODE_ENV='production' '${process.execPath}' '${SERVER_PATH}'`;
    serverProcess = spawn(
      "sudo", ["-S", "-E", "sh", "-c", inlineCmd],
      { detached: false, stdio: ["pipe", "pipe", "pipe"] }
    );
    // Write password then close stdin so sudo proceeds
    serverProcess.stdin.write(`${sudoPassword}\n`);
    serverProcess.stdin.end();
  }

  serverPid = serverProcess.pid;
  fs.writeFileSync(PID_FILE, String(serverPid));

  let startError = null;
  if (!IS_WIN) {
    serverProcess.stdout.on("data", (data) => {
      console.log(`[MITM Server] ${data.toString().trim()}`);
    });
    serverProcess.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      // Capture meaningful errors (ignore sudo password prompt noise)
      if (msg && !msg.includes("Password:") && !msg.includes("password for")) {
        console.error(`[MITM Server Error] ${msg}`);
        startError = msg;
      }
    });
    serverProcess.on("exit", (code) => {
      console.log(`MITM server exited with code ${code}`);
      serverProcess = null;
      serverPid = null;
      try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    });
  }

  // Wait for server to be ready by polling health endpoint
  const health = await pollMitmHealth(IS_WIN ? 12000 : 8000);

  if (!health) {
    if (IS_WIN) serverProcess = null;
    try { await removeDNSEntry(sudoPassword); } catch { /* best effort */ }
    const reason = startError || "Check sudo password or port 443 access.";
    throw new Error(`MITM server failed to start. ${reason}`);
  }

  // On Windows, use real PID from health check (launcher exits immediately after UAC)
  if (IS_WIN && health.pid) {
    serverPid = health.pid;
    fs.writeFileSync(PID_FILE, String(serverPid));
  }

  await saveMitmSettings(true, sudoPassword);
  if (sudoPassword) setCachedPassword(sudoPassword);

  return { running: true, pid: serverPid };
}

/**
 * Stop MITM proxy
 * @param {string} sudoPassword - Sudo password for DNS cleanup
 */
async function stopMitm(sudoPassword) {
  const proc = serverProcess;
  if (proc && !proc.killed) {
    console.log("Stopping MITM server...");
    killProcess(proc.pid, false);
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (isProcessAlive(proc.pid)) killProcess(proc.pid, true);
    serverProcess = null;
    serverPid = null;
  } else {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          console.log(`Killing MITM server (PID: ${savedPid})...`);
          killProcess(savedPid, false);
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (isProcessAlive(savedPid)) killProcess(savedPid, true);
        }
      }
    } catch { /* ignore */ }
    serverProcess = null;
    serverPid = null;
  }

  console.log("Removing DNS entry...");
  await removeDNSEntry(sudoPassword);

  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }

  await saveMitmSettings(false, null);

  return { running: false, pid: null };
}

module.exports = {
  getMitmStatus,
  startMitm,
  stopMitm,
  getCachedPassword,
  setCachedPassword,
  loadEncryptedPassword,
  initDbHooks,
};
