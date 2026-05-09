#!/usr/bin/env node

/**
 * Postinstall hook for 9router CLI
 * Rebuilds better-sqlite3 native addon for the current platform
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const appDir = path.join(__dirname, "..", "app");
const betterSqlitePath = path.join(appDir, "node_modules", "better-sqlite3");

// Check if better-sqlite3 exists
if (!fs.existsSync(betterSqlitePath)) {
  console.log("better-sqlite3 not found, skipping rebuild");
  process.exit(0);
}

// Check if native binary is valid for current platform
function isValidBinary() {
  const buildDir = path.join(betterSqlitePath, "build", "Release");
  const binaryPath = path.join(buildDir, "better_sqlite3.node");

  if (!fs.existsSync(binaryPath)) {
    return false;
  }

  const fd = fs.openSync(binaryPath, "r");
  const buffer = Buffer.alloc(4);
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);

  const magic = buffer.toString("hex");

  // ELF (Linux): 7f454c46
  // Mach-O (macOS): cffaedfe or cefaedfe (little/big endian)
  // PE (Windows): 4d5a (MZ)
  const isLinux = magic.startsWith("7f454c46");
  const isMacOS = magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
  const isWindows = magic.startsWith("4d5a");

  const platform = process.platform;
  const expectedLinux = platform === "linux" && isLinux;
  const expectedMacOS = platform === "darwin" && isMacOS;
  const expectedWindows = platform === "win32" && isWindows;

  return expectedLinux || expectedMacOS || expectedWindows;
}

// Skip rebuild if binary is already valid
if (isValidBinary()) {
  console.log("better-sqlite3 binary is valid for this platform, skipping rebuild");
  process.exit(0);
}

console.log("Rebuilding better-sqlite3 for current platform...");

try {
  execSync("npm rebuild better-sqlite3 --build-from-source", {
    cwd: appDir,
    stdio: "inherit",
    timeout: 120000
  });
  console.log("better-sqlite3 rebuilt successfully");
} catch (error) {
  console.warn("Failed to rebuild better-sqlite3. The app may not work correctly.");
  console.warn("Make sure you have build tools installed (python, make, gcc/node-gyp)");
  console.warn("Error:", error.message);
  // Don't exit with error code - allow install to complete
  process.exit(0);
}
