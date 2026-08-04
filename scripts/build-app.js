#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const nextBin = require.resolve("next/dist/bin/next");

function runBuild(env) {
  const result = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.platform !== "win32") {
  process.exit(runBuild(process.env));
}

// CLI packaging already calls root build with isolated env + tracing overrides.
// Respect that caller-provided sandbox instead of silently replacing it again.
if (process.env.NEXT_DIST_DIR || process.env.NEXT_TRACING_ROOT_MODE) {
  process.exit(runBuild(process.env));
}

const buildHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-build-"));
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Roaming"), { recursive: true });
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Local"), { recursive: true });

const status = runBuild({
  ...process.env,
  HOME: buildHomeDir,
  USERPROFILE: buildHomeDir,
  APPDATA: path.join(buildHomeDir, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(buildHomeDir, "AppData", "Local"),
});

try {
  fs.rmSync(buildHomeDir, { recursive: true, force: true });
} catch {}

process.exit(status);
