const { exec, spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const https = require("https");
const crypto = require("crypto");
const { addDNSEntry, removeDNSEntry, removeAllDNSEntries, checkAllDNSStatus } = require("./dns/dnsConfig");

const IS_WIN = process.platform === "win32";
const { generateCert } = require("./cert/generate");
const { installCert } = require("./cert/install");
const { MITM_DIR } = require("./paths");

const MITM_PORT = 443;
const MITM_WIN_NODE_PORT = 8443;
const PID_FILE = path.join(MITM_DIR, ".mitm.pid");

function resolveServerPath() {
  if (process.env.MITM_SERVER_PATH) return process.env.MITM_SERVER_PATH;
  const sibling = path.join(__dirname, "server.js");
  if (fs.existsSync(sibling)) return sibling;
  const fromCwd = path.join(process.cwd(), "src", "mitm", "server.js");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromNext = path.join(process.cwd(), "..", "src", "mitm", "server.js");
  if (fs.existsSync(fromNext)) return fromNext;
  return fromCwd;
}

const SERVER_PATH = resolveServerPath();
const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "9router-mitm-pwd";

function getProcessUsingPort443() {
  try {
    if (IS_WIN) {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command ` +
        `"$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess } else { 0 }"`;
      const pidStr = execSync(psCmd, { encoding: "utf8", windowsHide: true }).trim();
      const pid = parseInt(pidStr, 10);
      if (pid && pid > 4) {
        const tasklistResult = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8", windowsHide: true });
        const processMatch = tasklistResult.match(/"([^"]+)"/);
        if (processMatch) return processMatch[1].replace(".exe", "");
      }
    } else {
      const result = execSync("lsof -i :443", { encoding: "utf8" });
      const lines = result.trim().split("\n");
      if (lines.length > 1) return lines[1].split(/\s+/)[0];
    }
  } catch {
    return null;
  }
  return null;
}

let serverProcess = null;
let serverPid = null;

function getCachedPassword() { return globalThis.__mitmSudoPassword || null; }
function setCachedPassword(pwd) { globalThis.__mitmSudoPassword = pwd; }

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EACCES";
  }
}

function killProcess(pid, force = false, sudoPassword = null) {
  if (IS_WIN) {
    const flag = force ? "/F " : "";
    exec(`taskkill ${flag}/PID ${pid}`, () => { });
  } else {
    const sig = force ? "SIGKILL" : "SIGTERM";
    const cmd = `pkill -${sig} -P ${pid} 2>/dev/null; kill -${sig} ${pid} 2>/dev/null`;
    if (sudoPassword) {
      const { execWithPassword } = require("./dns/dnsConfig");
      execWithPassword(cmd, sudoPassword).catch(() => exec(cmd, () => { }));
    } else {
      exec(cmd, () => { });
    }
  }
}

function deriveKey() {
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + ENCRYPT_SALT).digest();
  } catch {
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

function encryptPassword(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

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

let _getSettings = null;
let _updateSettings = null;

function initDbHooks(getSettingsFn, updateSettingsFn) {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

async function saveMitmSettings(enabled, password) {
  if (!_updateSettings) return;
  try {
    const updates = { mitmEnabled: enabled };
    if (password) updates.mitmSudoEncrypted = encryptPassword(password);
    await _updateSettings(updates);
  } catch (e) {
    console.log("[MITM] Failed to save settings:", e.message);
  }
}

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

function checkPort443Free() {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve("in-use");
      else resolve("no-permission");
    });
    tester.once("listening", () => { tester.close(() => resolve("free")); });
    tester.listen(MITM_PORT, "127.0.0.1");
  });
}

function getPort443Owner(sudoPassword) {
  return new Promise((resolve) => {
    if (IS_WIN) {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "` +
        `$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        `if ($c) { $c.OwningProcess } else { 0 }"`;
      exec(psCmd, { windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null);
        const pid = parseInt(stdout.trim(), 10);
        if (!pid || pid <= 4) return resolve(null);
        exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { windowsHide: true }, (e2, out2) => {
          const m = out2?.match(/"([^"]+)"/);
          resolve({ pid, name: m ? m[1] : "unknown" });
        });
      });
    } else {
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

async function killLeftoverMitm(sudoPassword) {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill("SIGKILL"); } catch { /* ignore */ }
    serverProcess = null;
    serverPid = null;
  }
  try {
    if (fs.existsSync(PID_FILE)) {
      const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (savedPid && isProcessAlive(savedPid)) {
        killProcess(savedPid, true, sudoPassword);
        await new Promise(r => setTimeout(r, 500));
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch { /* ignore */ }
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

function pollMitmHealth(timeoutMs, port = MITM_PORT) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = https.request(
        { hostname: "127.0.0.1", port, path: "/_mitm_health", method: "GET", rejectUnauthorized: false },
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
 * Get full MITM status including per-tool DNS status
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
    } catch { /* ignore */ }
  }

  const dnsStatus = checkAllDNSStatus();
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const certExists = fs.existsSync(rootCACertPath);

  return { running, pid, certExists, dnsStatus };
}

/**
 * Start MITM server only (cert + server, no DNS)
 */
async function startServer(apiKey, sudoPassword) {
  if (!serverProcess || serverProcess.killed) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          serverPid = savedPid;
          console.log(`[MITM] Reusing existing process PID ${savedPid}`);
          await saveMitmSettings(true, sudoPassword);
          if (sudoPassword) setCachedPassword(sudoPassword);
          return { running: true, pid: savedPid };
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { /* ignore */ }
  }

  if (serverProcess && !serverProcess.killed) {
    throw new Error("MITM server is already running");
  }

  await killLeftoverMitm(sudoPassword);

  if (!IS_WIN) {
    const portStatus = await checkPort443Free();
    if (portStatus === "in-use" || portStatus === "no-permission") {
      const owner = await getPort443Owner(sudoPassword);
      if (owner && owner.name === "node") {
        console.log(`[MITM] Killing orphan node process on port 443 (PID ${owner.pid})...`);
        try {
          const { execWithPassword } = require("./dns/dnsConfig");
          await execWithPassword(`kill -9 ${owner.pid}`, sudoPassword);
          await new Promise(r => setTimeout(r, 800));
        } catch { /* best effort */ }
      } else if (owner) {
        const shortName = owner.name.includes("/")
          ? owner.name.split("/").filter(Boolean).pop()
          : owner.name;
        throw new Error(`Port 443 is already in use by "${shortName}" (PID ${owner.pid}). Stop that process first.`);
      }
    }
  }

  // Step 1: Auto-migration - Generate Root CA if not exists
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const rootCAKeyPath = path.join(MITM_DIR, "rootCA.key");

  if (!fs.existsSync(rootCACertPath) || !fs.existsSync(rootCAKeyPath)) {
    console.log("[MITM] Generating Root CA certificate (first time or migration)...");
    await generateCert();
  }

  // Step 1.5: Auto-install Root CA if not trusted yet
  const { checkCertInstalled } = require("./cert/install");
  const rootCATrusted = await checkCertInstalled(rootCACertPath);
  if (!rootCATrusted) {
    console.log("[MITM] Installing Root CA to system trust store...");
    // Use provided password or cached/stored password
    const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
    if (!password && !IS_WIN) {
      throw new Error("Sudo password required to install Root CA certificate");
    }
    await installCert(password, rootCACertPath);
    console.log("✅ Root CA installed successfully");
  }

  // Step 2: Spawn server (Root CA already installed in Step 1.5)
  if (IS_WIN) {
    const hostsFile = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
    const flagFile = path.join(os.tmpdir(), `mitm_ready_${Date.now()}.flag`);
    const psSQ = (s) => s.replace(/'/g, "''");
    const nodePs = psSQ(process.execPath);
    const serverPs = psSQ(SERVER_PATH);
    const flagPs = psSQ(flagFile);

    const psScript = [
      `$conn = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
      `if ($conn -and $conn.OwningProcess -gt 4) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      `Start-Sleep -Milliseconds 500`,
      `$nodeCmd = 'set ROUTER_API_KEY=${psSQ(apiKey)}&& set NODE_ENV=production&& "${nodePs}" "${serverPs}"'`,
      `Start-Process cmd -ArgumentList '/c',$nodeCmd -WindowStyle Hidden`,
      `Start-Sleep -Milliseconds 500`,
      `Set-Content -Path '${flagPs}' -Value 'ready' -Encoding UTF8`,
    ].join("\n");

    const tmpPs1 = path.join(os.tmpdir(), `mitm_start_${Date.now()}.ps1`);
    fs.writeFileSync(tmpPs1, psScript, "utf8");
    const vbs = [
      `Set oShell = CreateObject("Shell.Application")`,
      `Dim ps`,
      `ps = Chr(34) & "powershell.exe" & Chr(34)`,
      `Dim args`,
      `args = "-NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & "${tmpPs1}" & Chr(34)`,
      `oShell.ShellExecute ps, args, "", "runas", 1`,
    ].join("\r\n");
    const tmpVbs = path.join(os.tmpdir(), `mitm_uac_${Date.now()}.vbs`);
    fs.writeFileSync(tmpVbs, vbs, "utf8");
    spawn("wscript.exe", [tmpVbs], { stdio: "ignore", windowsHide: false, detached: true }).unref();

    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 90000;
      const poll = () => {
        if (fs.existsSync(flagFile)) {
          try { fs.unlinkSync(flagFile); fs.unlinkSync(tmpPs1); fs.unlinkSync(tmpVbs); } catch { /* ignore */ }
          return resolve();
        }
        if (Date.now() > deadline) return reject(new Error("Timed out waiting for UAC confirmation."));
        setTimeout(poll, 500);
      };
      poll();
    });

    if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });
  } else {
    // Non-Windows: Root CA already installed in Step 1.5, just spawn server
    const inlineCmd = `ROUTER_API_KEY='${apiKey}' NODE_ENV='production' '${process.execPath}' '${SERVER_PATH}'`;
    serverProcess = spawn(
      "sudo", ["-S", "-E", "sh", "-c", inlineCmd],
      { detached: false, stdio: ["pipe", "pipe", "pipe"] }
    );
    serverProcess.stdin.write(`${sudoPassword}\n`);
    serverProcess.stdin.end();
  }

  if (!IS_WIN && serverProcess) {
    serverPid = serverProcess.pid;
    fs.writeFileSync(PID_FILE, String(serverPid));
  }

  let startError = null;
  if (!IS_WIN) {
    serverProcess.stdout.on("data", (data) => {
      console.log(`[MITM Server] ${data.toString().trim()}`);
    });
    serverProcess.stderr.on("data", (data) => {
      const msg = data.toString().trim();
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

  const health = await pollMitmHealth(IS_WIN ? 15000 : 8000, MITM_PORT);
  if (!health) {
    if (IS_WIN) serverProcess = null;
    const processUsing443 = getProcessUsingPort443();
    const portInfo = processUsing443 ? ` Port 443 already in use by ${processUsing443}.` : "";
    const reason = startError || `Check sudo password or port 443 access.${portInfo}`;
    throw new Error(`MITM server failed to start. ${reason}`);
  }

  if (IS_WIN && _updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });
  if (IS_WIN && health.pid) {
    serverPid = health.pid;
    fs.writeFileSync(PID_FILE, String(serverPid));
  }

  await saveMitmSettings(true, sudoPassword);
  if (sudoPassword) setCachedPassword(sudoPassword);

  return { running: true, pid: serverPid };
}

/**
 * Stop MITM server — removes ALL tool DNS entries first, then kills server
 */
async function stopServer(sudoPassword) {
  // Remove all DNS entries first (before killing server)
  console.log("[MITM] Removing all DNS entries before stopping server...");
  await removeAllDNSEntries(sudoPassword);

  const proc = serverProcess;
  if (proc && !proc.killed) {
    console.log("Stopping MITM server...");
    killProcess(proc.pid, false, sudoPassword);
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (isProcessAlive(proc.pid)) killProcess(proc.pid, true, sudoPassword);
    serverProcess = null;
    serverPid = null;
  } else {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          console.log(`Killing MITM server (PID: ${savedPid})...`);
          killProcess(savedPid, false, sudoPassword);
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (isProcessAlive(savedPid)) killProcess(savedPid, true, sudoPassword);
        }
      }
    } catch { /* ignore */ }
    serverProcess = null;
    serverPid = null;
  }

  if (IS_WIN) {
    const hostsFile = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
    const psSQ = (s) => s.replace(/'/g, "''");
    const { TOOL_HOSTS } = require("./dns/dnsConfig");
    const allHosts = Object.values(TOOL_HOSTS).flat();

    let hostsContent = "";
    try { hostsContent = fs.readFileSync(hostsFile, "utf8"); } catch { /* ignore */ }
    const filtered = hostsContent.split(/\r?\n/)
      .filter(l => !allHosts.some(h => l.includes(h)))
      .join("\r\n");
    const tmpHosts = path.join(os.tmpdir(), "mitm_hosts_clean.tmp");
    fs.writeFileSync(tmpHosts, filtered, "utf8");

    const flagFile = path.join(os.tmpdir(), "mitm_stop_done.flag");
    const psScript = [
      `Copy-Item -Path '${psSQ(tmpHosts)}' -Destination '${psSQ(hostsFile)}' -Force`,
      `& ipconfig /flushdns | Out-Null`,
      `Remove-Item '${psSQ(tmpHosts)}' -ErrorAction SilentlyContinue`,
      `Set-Content -Path '${psSQ(flagFile)}' -Value 'done' -Encoding UTF8`,
    ].join("\n");
    const tmpPs1 = path.join(os.tmpdir(), "mitm_stop.ps1");
    fs.writeFileSync(tmpPs1, psScript, "utf8");

    const vbs = [
      `Set oShell = CreateObject("Shell.Application")`,
      `Dim args`,
      `args = "-NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & "${tmpPs1}" & Chr(34)`,
      `oShell.ShellExecute "powershell.exe", args, "", "runas", 1`,
    ].join("\r\n");
    const tmpVbs = path.join(os.tmpdir(), "mitm_stop_uac.vbs");
    fs.writeFileSync(tmpVbs, vbs, "utf8");
    spawn("wscript.exe", [tmpVbs], { stdio: "ignore", windowsHide: false, detached: true }).unref();

    await new Promise((resolve) => {
      const deadline = Date.now() + 30000;
      const poll = () => {
        if (fs.existsSync(flagFile)) {
          try { fs.unlinkSync(flagFile); fs.unlinkSync(tmpPs1); fs.unlinkSync(tmpVbs); } catch { /* ignore */ }
          return resolve();
        }
        if (Date.now() > deadline) return resolve();
        setTimeout(poll, 500);
      };
      poll();
    });
  }

  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  await saveMitmSettings(false, null);

  return { running: false, pid: null };
}

/**
 * Enable DNS for a specific tool (requires server running)
 */
async function enableToolDNS(tool, sudoPassword) {
  const status = await getMitmStatus();
  if (!status.running) throw new Error("MITM server is not running. Start the server first.");
  
  // Use cached password if not provided
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await addDNSEntry(tool, password);
  return { success: true };
}

/**
 * Disable DNS for a specific tool
 */
async function disableToolDNS(tool, sudoPassword) {
  // Use cached password if not provided
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await removeDNSEntry(tool, password);
  return { success: true };
}

// Legacy aliases for backward compatibility
const startMitm = startServer;
const stopMitm = stopServer;

module.exports = {
  getMitmStatus,
  startServer,
  stopServer,
  enableToolDNS,
  disableToolDNS,
  // Legacy
  startMitm,
  stopMitm,
  getCachedPassword,
  setCachedPassword,
  loadEncryptedPassword,
  initDbHooks,
};
