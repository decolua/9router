/**
 * Sync cleanup of MITM DNS entries from the system hosts file.
 * Used by cli.js on quit (tray / Ctrl+C) — the Next.js child is SIGKILL'd
 * before initializeApp cleanup can run, so the parent CLI must do this.
 *
 * Keep TOOL_HOSTS in sync with src/shared/constants/mitmToolHosts.js
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

const TOOL_HOSTS = {
  antigravity: ["daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com"],
  copilot: ["api.individual.githubcopilot.com"],
  kiro: ["runtime.us-east-1.kiro.dev", "q.us-east-1.amazonaws.com", "codewhisperer.us-east-1.amazonaws.com"],
  cursor: ["api2.cursor.sh"],
};

function tryRequireDnsConfig() {
  const root = path.join(__dirname, "..");
  const candidates = [
    path.join(root, "app", "src", "mitm", "dns", "dnsConfig.js"),
    path.join(root, "..", "src", "mitm", "dns", "dnsConfig.js"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return require(p);
    } catch { /* try next */ }
  }
  return null;
}

function flushDnsCacheSync() {
  if (IS_WIN) {
    try { execSync("ipconfig /flushdns", { windowsHide: true, stdio: "ignore" }); } catch { /* ignore */ }
  } else if (IS_MAC) {
    try { execSync("dscacheutil -flushcache && killall -HUP mDNSResponder", { stdio: "ignore" }); } catch { /* ignore */ }
  } else {
    try { execSync("resolvectl flush-caches 2>/dev/null || true", { stdio: "ignore" }); } catch { /* ignore */ }
  }
}

function writeHostsFileSync(next, original) {
  try {
    fs.writeFileSync(HOSTS_FILE, next, "utf8");
    return true;
  } catch {
    if (!IS_WIN) return false;
    // Windows fallback: filter via PowerShell (works when CLI has admin)
    try {
      const allHosts = Object.values(TOOL_HOSTS).flat();
      const hostsList = allHosts.map((h) => `'${h.replace(/'/g, "''")}'`).join(",");
      const hostsPath = HOSTS_FILE.replace(/'/g, "''");
      const script = `
        $targets = @(${hostsList})
        $path = '${hostsPath}'
        $lines = Get-Content -LiteralPath $path -ErrorAction Stop
        $filtered = $lines | Where-Object {
          $line = $_
          -not ($targets | Where-Object { $line -match [regex]::Escape($_) })
        }
        Set-Content -LiteralPath $path -Value $filtered -Encoding UTF8
        ipconfig /flushdns | Out-Null
      `;
      execSync(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`,
        { windowsHide: true, stdio: "ignore", timeout: 10000 },
      );
      return true;
    } catch {
      try { fs.writeFileSync(HOSTS_FILE, original, "utf8"); } catch { /* ignore */ }
      return false;
    }
  }
}

function cleanupMitmHostsFile() {
  const dnsConfig = tryRequireDnsConfig();
  if (dnsConfig?.removeAllDNSEntriesSync) {
    dnsConfig.removeAllDNSEntriesSync();
    return;
  }

  try {
    if (!fs.existsSync(HOSTS_FILE)) return;
    const allHosts = Object.values(TOOL_HOSTS).flat();
    const content = fs.readFileSync(HOSTS_FILE, "utf8");
    const eol = IS_WIN ? "\r\n" : "\n";
    const filtered = content.split(/\r?\n/).filter((l) => !allHosts.some((h) => l.includes(h))).join(eol);
    const next = filtered.replace(/[\r\n\s]+$/g, "") + eol;
    if (next === content) return;
    if (!writeHostsFileSync(next, content)) return;
    flushDnsCacheSync();
  } catch { /* best effort during shutdown */ }
}

module.exports = { cleanupMitmHostsFile, TOOL_HOSTS };
