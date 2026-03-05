const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Per-tool DNS hosts mapping
const TOOL_HOSTS = {
  antigravity: ["daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com"],
  copilot: ["api.individual.githubcopilot.com"],
};

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

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
    console.log(`DNS entries for ${tool} already exist`);
    return;
  }

  const entries = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\n");

  try {
    if (IS_WIN) {
      const hostsPath = HOSTS_FILE.replace(/'/g, "''");
      const addLines = entriesToAdd.map(h =>
        `$hc = Get-Content -Path '${hostsPath}' -Raw -ErrorAction SilentlyContinue; if ($hc -notmatch '${h}') { Add-Content -Path '${hostsPath}' -Value '127.0.0.1 ${h}' -Encoding UTF8 }`
      ).join("; ");
      const psScript = `${addLines}; ipconfig /flushdns | Out-Null`;
      await new Promise((resolve, reject) => {
        const escaped = psScript.replace(/"/g, '\\"');
        exec(
          `powershell -NonInteractive -WindowStyle Hidden -Command "Start-Process powershell -ArgumentList '-NonInteractive -WindowStyle Hidden -Command \\"${escaped}\\"' -Verb RunAs -Wait"`,
          { windowsHide: true },
          (error) => { if (error) reject(new Error(`Failed to add DNS: ${error.message}`)); else resolve(); }
        );
      });
    } else {
      await execWithPassword(`echo "${entries}" >> ${HOSTS_FILE}`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    console.log(`✅ Added DNS entries for ${tool}: ${entriesToAdd.join(", ")}`);
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
    console.log(`DNS entries for ${tool} do not exist`);
    return;
  }

  try {
    if (IS_WIN) {
      const content = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = content.split(/\r?\n/).filter(l => !entriesToRemove.some(h => l.includes(h))).join("\r\n");
      const tmpFile = path.join(os.tmpdir(), "hosts_filtered.tmp");
      fs.writeFileSync(tmpFile, filtered, "utf8");
      const tmpEsc = tmpFile.replace(/'/g, "''");
      const hostsEsc = HOSTS_FILE.replace(/'/g, "''");
      const psScript = `Copy-Item -Path '${tmpEsc}' -Destination '${hostsEsc}' -Force; ipconfig /flushdns | Out-Null; Remove-Item '${tmpEsc}' -ErrorAction SilentlyContinue`;
      await new Promise((resolve, reject) => {
        const escaped = psScript.replace(/"/g, '\\"');
        exec(
          `powershell -NonInteractive -WindowStyle Hidden -Command "Start-Process powershell -ArgumentList '-NonInteractive -WindowStyle Hidden -Command \\"${escaped}\\"' -Verb RunAs -Wait"`,
          { windowsHide: true },
          (error) => {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            if (error) reject(new Error(`Failed to remove DNS: ${error.message}`));
            else resolve();
          }
        );
      });
    } else {
      for (const host of entriesToRemove) {
        const sedCmd = IS_MAC
          ? `sed -i '' '/${host}/d' ${HOSTS_FILE}`
          : `sed -i '/${host}/d' ${HOSTS_FILE}`;
        await execWithPassword(sedCmd, sudoPassword);
      }
      await flushDNS(sudoPassword);
    }
    console.log(`✅ Removed DNS entries for ${tool}: ${entriesToRemove.join(", ")}`);
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
      console.log(`[MITM] Warning: failed to remove DNS for ${tool}: ${e.message}`);
    }
  }
}

module.exports = {
  TOOL_HOSTS,
  addDNSEntry,
  removeDNSEntry,
  removeAllDNSEntries,
  execWithPassword,
  checkDNSEntry,
  checkAllDNSStatus,
};
