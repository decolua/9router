const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const TARGET_HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com"
];
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
 * Execute elevated command on Windows via PowerShell RunAs (hidden window)
 */
function execElevatedWindows(command) {
  return new Promise((resolve, reject) => {
    const escaped = command.replace(/'/g, "''");
    const psCommand = `Start-Process cmd -ArgumentList '/c','${escaped}' -Verb RunAs -Wait -WindowStyle Hidden`;
    exec(
      `powershell -NonInteractive -WindowStyle Hidden -Command "${psCommand}"`,
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`Elevated command failed: ${error.message}\n${stderr}`));
        else resolve(stdout);
      }
    );
  });
}

/**
 * Check if DNS entry already exists for a specific host
 */
function checkDNSEntry(host = null) {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    if (host) {
      return hostsContent.includes(host);
    }
    // Check if all target hosts exist
    return TARGET_HOSTS.every(h => hostsContent.includes(h));
  } catch {
    return false;
  }
}

/**
 * Add DNS entry to hosts file
 */
async function addDNSEntry(sudoPassword) {
  const entriesToAdd = TARGET_HOSTS.filter(host => !checkDNSEntry(host));
  
  if (entriesToAdd.length === 0) {
    console.log(`DNS entries for all target hosts already exist`);
    return;
  }

  const entries = entriesToAdd.map(host => `127.0.0.1 ${host}`).join("\n");

  try {
    if (IS_WIN) {
      // Windows: add all entries + flush in one elevated PowerShell call (single UAC)
      const hostsPath = HOSTS_FILE.replace(/'/g, "''");
      const addLines = entriesToAdd.map(host =>
        `$hc = Get-Content -Path '${hostsPath}' -Raw -ErrorAction SilentlyContinue; if ($hc -notmatch '${host}') { Add-Content -Path '${hostsPath}' -Value '127.0.0.1 ${host}' -Encoding UTF8 }`
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
    }
    // Flush DNS cache (non-Windows)
    if (IS_WIN) {
      // already flushed above
    } else if (IS_MAC) {
      await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
    } else {
      // Linux: try systemd-resolved, fall back silently
      await execWithPassword("resolvectl flush-caches 2>/dev/null || true", sudoPassword);
    }
    console.log(`✅ Added DNS entries: ${entriesToAdd.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : "Failed to add DNS entry";
    throw new Error(msg);
  }
}

/**
 * Remove DNS entry from hosts file
 */
async function removeDNSEntry(sudoPassword) {
  const entriesToRemove = TARGET_HOSTS.filter(host => checkDNSEntry(host));
  
  if (entriesToRemove.length === 0) {
    console.log(`DNS entries for target hosts do not exist`);
    return;
  }

  try {
    if (IS_WIN) {
      // Read in Node, filter, write to temp file, then single elevated-copy + flush (1 UAC)
      const content = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = content.split(/\r?\n/).filter(l => !TARGET_HOSTS.some(host => l.includes(host))).join("\r\n");
      if (!filtered.trim() && content.trim()) {
        throw new Error("Filtered hosts content is empty, aborting to prevent data loss");
      }
      const tmpFile = path.join(os.tmpdir(), "hosts_filtered.tmp");
      fs.writeFileSync(tmpFile, filtered, "utf8");
      const tmpEsc = tmpFile.replace(/'/g, "''");
      const hostsEsc = HOSTS_FILE.replace(/'/g, "''");
      // Single UAC: copy temp file over hosts + flush DNS
      const psScript = `Copy-Item -Path '${tmpEsc}' -Destination '${hostsEsc}' -Force; ipconfig /flushdns | Out-Null; Remove-Item '${tmpEsc}' -ErrorAction SilentlyContinue`;
      await new Promise((resolve, reject) => {
        const escaped = psScript.replace(/"/g, '\\"');
        exec(
          `powershell -NonInteractive -WindowStyle Hidden -Command "Start-Process powershell -ArgumentList '-NonInteractive -WindowStyle Hidden -Command \\"${escaped}\\"' -Verb RunAs -Wait"`,
          { windowsHide: true },
          (error) => {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            if (error) reject(new Error(`Failed to remove DNS entry: ${error.message}`));
            else resolve();
          }
        );
      });
    } else {
      // Remove all target hosts using sed
      for (const host of entriesToRemove) {
        const sedCmd = IS_MAC
          ? `sed -i '' '/${host}/d' ${HOSTS_FILE}`
          : `sed -i '/${host}/d' ${HOSTS_FILE}`;
        await execWithPassword(sedCmd, sudoPassword);
      }
    }
    // Flush DNS cache (non-Windows, already flushed above for Windows)
    if (IS_WIN) {
      // already flushed above
    } else if (IS_MAC) {
      await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
    } else {
      await execWithPassword("resolvectl flush-caches 2>/dev/null || true", sudoPassword);
    }
    console.log(`✅ Removed DNS entries for ${entriesToRemove.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : "Failed to remove DNS entry";
    throw new Error(msg);
  }
}

module.exports = { addDNSEntry, removeDNSEntry, execWithPassword, checkDNSEntry };
