const { exec, execSync } = require("child_process");

const IS_WIN = process.platform === "win32";

/**
 * Detect if current Windows process has admin rights (no UAC popup needed).
 * Uses `net session` which only succeeds when elevated.
 */
function isAdmin() {
  if (IS_WIN) {
    try {
      execSync("net session >nul 2>&1", { windowsHide: true, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/**
 * Quote a string safely for PowerShell single-quoted literal.
 */
function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Run PowerShell script — escalated via UAC popup if not already admin.
 * Returns Promise resolving on exit code 0, rejecting otherwise.
 *
 * IMPORTANT: each call triggers ONE UAC popup. Batch multiple admin tasks
 * into a single script string to minimize popups.
 */
function runElevatedPowerShell(script) {
  if (!IS_WIN) return Promise.reject(new Error("Windows-only"));

  const encoded = Buffer.from(script, "utf16le").toString("base64");

  // If already admin, run directly — zero popup
  if (isAdmin()) {
    return new Promise((resolve, reject) => {
      exec(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
        { windowsHide: true },
        (error, stdout, stderr) => {
          if (error) reject(new Error(stderr || error.message));
          else resolve(stdout);
        }
      );
    });
  }

  // Not admin — wrap with Start-Process -Verb RunAs (UAC popup)
  const wrapper = `
    $proc = Start-Process powershell -ArgumentList @(
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-WindowStyle','Hidden','-EncodedCommand','${encoded}'
    ) -Verb RunAs -Wait -PassThru -WindowStyle Hidden;
    if ($proc.ExitCode -ne 0) { throw "Elevated command exited with code $($proc.ExitCode)" }
  `;

  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ${quotePs(wrapper)}`,
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message;
          if (msg.includes("canceled by the user") || msg.includes("operation was canceled")) {
            reject(new Error("User canceled UAC prompt"));
          } else {
            reject(new Error(msg));
          }
        } else resolve(stdout);
      }
    );
  });
}

module.exports = { isAdmin, runElevatedPowerShell, quotePs };
