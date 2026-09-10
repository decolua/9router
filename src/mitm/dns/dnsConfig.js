const { exec, spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { log, err } = require("../logger");
const { TOOL_HOSTS } = require("../../shared/constants/mitmToolHosts.js");
const { runElevatedPowerShell, quotePs } = require("../winElevated.js");

function psArray(values) {
  return values.map(quotePs).join(", ");
}

function buildAddHostsScript(hosts) {
  return `
    $hostsPath = ${quotePs(HOSTS_FILE)}
    $hostsToAdd = @(${psArray(hosts)})
    $content = if (Test-Path -LiteralPath $hostsPath) { Get-Content -LiteralPath $hostsPath -Raw } else { "" }
    $lines = if ($content) { $content -split "\\r?\\n" } else { @() }
    $next = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
      $trimmedRight = $line.TrimEnd()
      if ($trimmedRight.Trim().Length -gt 0) { [void]$next.Add($trimmedRight) }
    }
    foreach ($hostName in $hostsToAdd) {
      $exists = $false
      foreach ($line in $next) {
        if ($line -match ("(^|\\s)" + [regex]::Escape($hostName) + "(\\s|$)")) { $exists = $true; break }
      }
      if (-not $exists) { [void]$next.Add("127.0.0.1 $hostName") }
    }
    $newContent = ($next -join [Environment]::NewLine) + [Environment]::NewLine
    $tmpNew = "$hostsPath.9router.new"
    $tmpBak = "$hostsPath.9router.bak"
    Set-Content -LiteralPath $tmpNew -Value $newContent -NoNewline -Encoding utf8
    Remove-Item -LiteralPath $tmpBak -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $hostsPath) { Rename-Item -LiteralPath $hostsPath -NewName ([System.IO.Path]::GetFileName($tmpBak)) -Force }
    try {
      Rename-Item -LiteralPath $tmpNew -NewName ([System.IO.Path]::GetFileName($hostsPath)) -Force
      Remove-Item -LiteralPath $tmpBak -ErrorAction SilentlyContinue
    } catch {
      if (Test-Path -LiteralPath $tmpBak) { Rename-Item -LiteralPath $tmpBak -NewName ([System.IO.Path]::GetFileName($hostsPath)) -Force }
      throw
    }
    ipconfig /flushdns | Out-Null
  `;
}

function buildRemoveHostsScript(hosts) {
  return `
    $hostsPath = ${quotePs(HOSTS_FILE)}
    $hostsToRemove = @(${psArray(hosts)})
    if (-not (Test-Path -LiteralPath $hostsPath)) { exit 0 }
    $content = Get-Content -LiteralPath $hostsPath -Raw
    $lines = if ($content) { $content -split "\\r?\\n" } else { @() }
    $next = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
      $remove = $false
      foreach ($hostName in $hostsToRemove) {
        if ($line -match ("(^|\\s)" + [regex]::Escape($hostName) + "(\\s|$)")) { $remove = $true; break }
      }
      $trimmedRight = $line.TrimEnd()
      if (-not $remove -and $trimmedRight.Trim().Length -gt 0) { [void]$next.Add($trimmedRight) }
    }
    $newContent = ($next -join [Environment]::NewLine) + [Environment]::NewLine
    $tmpNew = "$hostsPath.9router.new"
    $tmpBak = "$hostsPath.9router.bak"
    Set-Content -LiteralPath $tmpNew -Value $newContent -NoNewline -Encoding utf8
    Remove-Item -LiteralPath $tmpBak -ErrorAction SilentlyContinue
    Rename-Item -LiteralPath $hostsPath -NewName ([System.IO.Path]::GetFileName($tmpBak)) -Force
    try {
      Rename-Item -LiteralPath $tmpNew -NewName ([System.IO.Path]::GetFileName($hostsPath)) -Force
      Remove-Item -LiteralPath $tmpBak -ErrorAction SilentlyContinue
    } catch {
      if (Test-Path -LiteralPath $tmpBak) { Rename-Item -LiteralPath $tmpBak -NewName ([System.IO.Path]::GetFileName($hostsPath)) -Force }
      throw
    }
    ipconfig /flushdns | Out-Null
  `;
}

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

/** True when `sudo` exists (e.g. missing on minimal Docker images like Alpine). */
function isSudoAvailable() {
  if (IS_WIN) return false;
  try {
    execSync("command -v sudo", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function canRunSudoWithoutPassword() {
  if (IS_WIN || !isSudoAvailable()) return true;
  try {
    execSync("sudo -n true", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function isSudoPasswordRequired() {
  return !IS_WIN && isSudoAvailable() && !canRunSudoWithoutPassword();
}

/**
 * Execute command with sudo password via stdin (macOS/Linux only).
 * Without sudo in PATH (containers), runs via sh — same user, no elevation.
 */
function execWithPassword(command, password) {
  return new Promise((resolve, reject) => {
    const useSudo = isSudoAvailable();
    const child = useSudo
      ? spawn("sudo", ["-S", "sh", "-c", command], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      : spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    if (useSudo) {
      child.stdin.write(`${password}\n`);
      child.stdin.end();
    }
  });
}

/**
 * Trim trailing blank lines/whitespace, ensure file ends with exactly one newline.
 */
function normalizeHostsContent(content) {
  const eol = IS_WIN ? "\r\n" : "\n";
  return content.replace(/[\r\n\s]+$/g, "") + eol;
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

  try {
    if (IS_WIN) {
      await runElevatedPowerShell(buildAddHostsScript(entriesToAdd));
    } else {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const trimmed = current.replace(/[\r\n\s]+$/g, "");
      const toAppend = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\n");
      const next = `${trimmed}\n${toAppend}\n`;
      // Use tee via sudo to overwrite atomically — escape single quotes in content
      const escaped = next.replace(/'/g, "'\\''");
      await execWithPassword(`printf '%s' '${escaped}' | tee ${HOSTS_FILE} > /dev/null`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ added ${entriesToAdd.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : `Failed to add DNS entry: ${error.message}`;
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
      await runElevatedPowerShell(buildRemoveHostsScript(entriesToRemove));
    } else {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = current.split(/\r?\n/).filter(l => !entriesToRemove.some(h => l.includes(h))).join("\n");
      const next = filtered.replace(/[\r\n\s]+$/g, "") + "\n";
      const escaped = next.replace(/'/g, "'\\''");
      await execWithPassword(`printf '%s' '${escaped}' | tee ${HOSTS_FILE} > /dev/null`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ removed ${entriesToRemove.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : `Failed to remove DNS entry: ${error.message}`;
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

/**
 * Sync removal of ALL tool DNS entries — for use during process shutdown
 * when async ops aren't safe. Assumes caller already has root/admin rights.
 */
function removeAllDNSEntriesSync() {
  try {
    if (!fs.existsSync(HOSTS_FILE)) return;
    const allHosts = Object.values(TOOL_HOSTS).flat();
    const content = fs.readFileSync(HOSTS_FILE, "utf8");
    const eol = IS_WIN ? "\r\n" : "\n";
    const filtered = content.split(/\r?\n/).filter(l => !allHosts.some(h => l.includes(h))).join(eol);
    const next = filtered.replace(/[\r\n\s]+$/g, "") + eol;
    if (next === content) return;
    fs.writeFileSync(HOSTS_FILE, next, "utf8");
    if (IS_WIN) {
      try { execSync("ipconfig /flushdns", { windowsHide: true, stdio: "ignore" }); } catch { /* ignore */ }
    } else if (IS_MAC) {
      try { execSync("dscacheutil -flushcache && killall -HUP mDNSResponder", { stdio: "ignore" }); } catch { /* ignore */ }
    } else {
      try { execSync("resolvectl flush-caches 2>/dev/null || true", { stdio: "ignore" }); } catch { /* ignore */ }
    }
  } catch { /* best effort during shutdown */ }
}

module.exports = {
  TOOL_HOSTS,
  addDNSEntry,
  removeDNSEntry,
  removeAllDNSEntries,
  removeAllDNSEntriesSync,
  execWithPassword,
  isSudoAvailable,
  canRunSudoWithoutPassword,
  isSudoPasswordRequired,
  checkDNSEntry,
  checkAllDNSStatus,
};
