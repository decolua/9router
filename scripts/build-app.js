#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const buildHomeDir = path.join(process.cwd(), ".build-home-app");
const nextBin = require.resolve("next/dist/bin/next");

function runBuild(env) {
  const result = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.platform !== "win32") {
  runBuild(process.env);
}

fs.mkdirSync(path.join(buildHomeDir, "AppData", "Roaming"), { recursive: true });
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Local"), { recursive: true });

runBuild({
  ...process.env,
  HOME: buildHomeDir,
  USERPROFILE: buildHomeDir,
  APPDATA: path.join(buildHomeDir, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(buildHomeDir, "AppData", "Local"),
});
