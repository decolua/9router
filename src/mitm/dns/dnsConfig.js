const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { log, err } = require("../logger");

// Per-tool DNS hosts mapping
const TOOL_HOSTS = {
  antigravity: ["daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com"],
  copilot: ["api.individual.githubcopilot.com"],
  kiro: ["q.us-east-1.amazonaws.com", "codewhisperer.us-east-1.amazonaws.com"],
};

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

/**
 * Execute elevated PowerShell script on Windows via Start-Process -Verb RunAs.
 * Only UAC consent dialog appears, no CMD/PS window popup.
 */
function executeElevatedPowerShell(psScriptPath, timeoutMs = 30000) {
  const flagFile = path.join(os.tmpdir(), `ps_done_${Date.now()}.flag`);
  const psSQ = (s) => s.replace(/'/g, "''");
  
  let psContent = fs.readFileSync(psScriptPath, "utf8");
  psContent += `\nSet-Content -Path '${psSQ(flagFile)}' -Value 'done' -Encoding UTF8\n`;
  fs.writeFileSync(psScriptPath, psContent, "utf8");

  const outerCmd = `Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','${psSQ(psScriptPath)}' -Verb RunAs -WindowStyle Hidden`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${outerCmd}"`,
      { windowsHide: true },
      () => {}
    );

    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (settled) return;
      if (fs.existsSync(flagFile)) {
        try { fs.unlinkSync(flagFile); fs.unlinkSync(psScriptPath); } catch { /* ignore */ }
        return settle(resolve);
      }
      if (Date.now() > deadline) {
        try { fs.unlinkSync(psScriptPath); } catch { /* ignore */ }
        return settle(reject, new Error("Timed out waiting for UAC confirmation"));
      }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 300);
  });
}

/**
 * Execute command with sudo password via stdin (macOS/Linux only)
 */
function execWithPassword(command, password) {
  return new Promise((resolve, reject) => {
    const child = spawn("sudo", ["-S", "sh", "-c", command], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    child.stdin.write(`${password}\n`);
    child.stdin.end();
  });
}

/**
 * Flush DNS cache (macOS/Linux)
 */
async function flushDNS(sudoPassword) {
  if (IS_WIN) return; // Windows flushes inline via ipconfig
  if (IS_MAC) {
    await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
  } else {
    await execWithPassword("resolvectl flush-caches 2>/dev/null || true", sudoPassword);
  }
}

/**
 * Check if DNS entry exists for a specific host
 */
function checkDNSEntry(host = null) {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    if (host) return hostsContent.includes(host);
    // Legacy: check all antigravity hosts (backward compat)
    return TOOL_HOSTS.antigravity.every(h => hostsContent.includes(h));
  } catch {
    return false;
  }
}

/**
 * Check DNS status per tool — returns { [tool]: boolean }
 */
function checkAllDNSStatus() {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    const result = {};
    for (const [tool, hosts] of Object.entries(TOOL_HOSTS)) {
      result[tool] = hosts.every(h => hostsContent.includes(h));
    }
    return result;
  } catch {
    return Object.fromEntries(Object.keys(TOOL_HOSTS).map(t => [t, false]));
  }
}

/**
 * Add DNS entries for a specific tool
 */
async function addDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToAdd = hosts.filter(h => !checkDNSEntry(h));
  if (entriesToAdd.length === 0) {
    log(`🌐 DNS ${tool}: already active`);
    return;
  }

  const entries = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\n");

  try {
    if (IS_WIN) {
      // Process already has admin rights — edit hosts file directly
      const toAppend = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\r\n") + "\r\n";
      fs.appendFileSync(HOSTS_FILE, toAppend, "utf8");
      require("child_process").execSync("ipconfig /flushdns", { windowsHide: true });
    } else {
      await execWithPassword(`echo "${entries}" >> ${HOSTS_FILE}`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ added ${entriesToAdd.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : "Failed to add DNS entry";
    throw new Error(msg);
  }
}

/**
 * Remove DNS entries for a specific tool
 */
async function removeDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToRemove = hosts.filter(h => checkDNSEntry(h));
  if (entriesToRemove.length === 0) {
    log(`🌐 DNS ${tool}: already inactive`);
    return;
  }

  try {
    if (IS_WIN) {
      // Process already has admin rights — edit hosts file directly
      const content = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = content.split(/\r?\n/).filter(l => !entriesToRemove.some(h => l.includes(h))).join("\r\n");
      fs.writeFileSync(HOSTS_FILE, filtered, "utf8");
      require("child_process").execSync("ipconfig /flushdns", { windowsHide: true });
    } else {
      for (const host of entriesToRemove) {
        const sedCmd = IS_MAC
          ? `sed -i '' '/${host}/d' ${HOSTS_FILE}`
          : `sed -i '/${host}/d' ${HOSTS_FILE}`;
        await execWithPassword(sedCmd, sudoPassword);
      }
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ removed ${entriesToRemove.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : "Failed to remove DNS entry";
    throw new Error(msg);
  }
}

/**
 * Remove ALL tool DNS entries (used when stopping server)
 */
async function removeAllDNSEntries(sudoPassword) {
  for (const tool of Object.keys(TOOL_HOSTS)) {
    try {
      await removeDNSEntry(tool, sudoPassword);
    } catch (e) {
      err(`DNS ${tool}: failed to remove — ${e.message}`);
    }
  }
}

module.exports = {
  TOOL_HOSTS,
  addDNSEntry,
  removeDNSEntry,
  removeAllDNSEntries,
  execWithPassword,
  executeElevatedPowerShell,
  checkDNSEntry,
  checkAllDNSStatus,
};
